# CS-303 Operating Systems Project Report

**Specification:** `Project (1).pdf` (inspired by MIT 6.1810)  
**Implementation Repository:** `/home/manan/xv6` (synced to `/home/manan/Operating_systems`)  
**Companion Directories:** `/home/manan/xv6-labs-tests` (clean MIT reference tests), `/home/manan/xv6-dashboard` (Flask + React test runner dashboard)

---

## 1. Executive Summary

All three tasks specified in `Project (1).pdf`—**Periodic User-Level Alarms**, **File-System Enhancements (Large Files & Symbolic Links)**, and **Memory-Mapped Files**—are implemented in `xv6` and pass all corresponding MIT 6.1810 verification suites (`alarmtest`, `bigfile`, `bigfiledemo`, `symlinktest`, `mmaptest`), targeted `usertests` VM/filesystem regression suites, and dedicated edge-case checks in QEMU.

In addition:
- Kernel scheduler and filesystem optimizations reduced the full 65,803-block `bigfile` write/read verification from **~50 minutes to 3 min 34 s (214 s)** (under MIT's 240 s grader timeout), without altering `user/bigfile.c` or the on-disk format.
- All actionable edge-case bugs uncovered during the audit across Tasks 1, 2A, 2B, and 3 have been **fixed and verified** in QEMU.

---

## 2. Task 1 — Periodic User-Level Alarms (`sigalarm` & `sigreturn`)

### 2.1 Requirement Summary
Add a periodic CPU-time alarm mechanism that transfers control to a user-registered handler after every `n` hardware timer ticks and seamlessly resumes interrupted user execution without altering observable register state (including `a0`). Calling `sigalarm(0, 0)` must disable future alarms, and alarm delivery must not be re-entrant while a handler is already executing.

### 2.2 How It Is Implemented
- **System-call interface & user stubs:**
  - Assigned `SYS_sigalarm` (22) and `SYS_sigreturn` (23) in `kernel/syscall.h` and registered `sys_sigalarm` / `sys_sigreturn` in `kernel/syscall.c`.
  - Added user stubs `entry("sigalarm")` and `entry("sigreturn")` in `user/usys.pl` and strict prototypes (`int sigalarm(int, void (*)());`, `int sigreturn(void);`) in `user/user.h`.
- **Per-process kernel bookkeeping (`kernel/proc.h`, `kernel/proc.c`, `kernel/exec.c`):**
  - Extended `struct proc` with an embedded `struct trapframe alarm_tf` (avoiding per-process 4 KB `kalloc()` overhead), `alarm_interval`, `alarm_ticks`, `in_handler`, and `alarm_handler`.
  - `allocproc()` and `freeproc()` zero all alarm fields; `exec()` resets all alarm fields when committing the new user image so stale handler addresses never execute after `exec()`. Because `fork()` initializes children via `allocproc()`, alarms are not inherited across `fork()`.
- **Alarm configuration, timer dispatch & restoration (`kernel/sysproc.c`, `kernel/trap.c`):**
  - `sys_sigalarm()` rejects negative intervals, stores `alarm_interval` and `alarm_handler`, and resets `alarm_ticks = 0`. Passing `interval = 0` disables subsequent alarms while leaving `in_handler` intact so a handler calling `sigalarm(0, 0)` can still finish via `sigreturn()`.
  - In `usertrap()`, on timer interrupts (`which_dev == 2`), if `p->alarm_interval > 0 && !p->in_handler`, the kernel increments `p->alarm_ticks`. Once `p->alarm_ticks >= p->alarm_interval`, it snapshots `p->alarm_tf = *p->trapframe`, redirects `p->trapframe->epc = p->alarm_handler`, sets `p->in_handler = 1`, and resets `p->alarm_ticks = 0`.
  - `sys_sigreturn()` returns `-1` if `!p->in_handler`; otherwise it restores `*p->trapframe = p->alarm_tf`, clears `p->in_handler = 0`, and returns `p->trapframe->a0` so `syscall()` preserves the interrupted program's original `a0`.

### 2.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| Syscall dispatch & user stubs | `kernel/syscall.h`, `kernel/syscall.c`, `user/usys.pl`, `user/user.h` | Built into `kernel/kernel` & `fs.img` |
| Per-process alarm state & `exec()` reset | `kernel/proc.h`, `kernel/proc.c`, `kernel/exec.c` | Verified via `alarmtest` + `alarm` + `exec()` check |
| Timer trigger & `sigalarm`/`sigreturn` | `kernel/trap.c`, `kernel/sysproc.c` | `alarmtest` `test0`–`test3` **PASS (2.9 s)** |
| Test binary | `user/alarmtest.c` | Single alarm, periodic + register restoration, non-reentrancy, `a0` preservation |

### 2.4 Edge Cases Fixed
1. **Fixed — `exec()` alarm reset (`kernel/exec.c`):** Cleared `alarm_interval`, `alarm_ticks`, `in_handler`, and `alarm_handler` on `exec()` commit; verified by arming `sigalarm(1, ...)` and `exec()`ing `echo`.
2. **Fixed — User-space prototype (`user/user.h`):** Updated `sigalarm` to `int sigalarm(int, void (*)());`.
3. **Fixed — Embedded `alarm_tf` (`kernel/proc.h`, `kernel/proc.c`, `kernel/trap.c`, `kernel/sysproc.c`):** Embedded `struct trapframe alarm_tf` directly in `struct proc`, removing the extra 4 KB `kalloc()`/`kfree()` per process.

---

## 3. Task 2A — File-System Enhancements: Large Files

### 3.1 Requirement Summary
Increase the maximum xv6 file size from 268 blocks to **65,803 blocks** while keeping the on-disk `struct dinode` size unchanged (64 bytes): 11 direct block pointers, 1 singly-indirect block pointer (256 blocks), and 1 doubly-indirect block pointer ($256 \times 256 = 65,536$ blocks). Update inode definitions, `bmap()`, `itrunc()`, and rebuild `fs.img`.

### 3.2 How It Is Implemented
- **On-disk & in-memory inode layout (`kernel/fs.h`, `kernel/file.h`, `kernel/param.h`):**
  - Set `NDIRECT 11`, `NINDIRECT (BSIZE / sizeof(uint))` (= 256), and `MAXFILE (NDIRECT + NINDIRECT + NINDIRECT*NINDIRECT)` (= 65,803) in `kernel/fs.h`.
  - Changed `addrs` to `uint addrs[NDIRECT+2]` (13 entries = 52 bytes, preserving `sizeof(struct dinode) == 64`) in both `struct dinode` (`kernel/fs.h`) and `struct inode` (`kernel/file.h`).
  - Increased `FSSIZE` to `200000` blocks (204.8 MB) in `kernel/param.h` and updated `mkfs/mkfs.c` `iappend()` to support doubly-indirect blocks as well.
- **Block mapping & truncation (`kernel/fs.c`):**
  - `bmap()` maps blocks `0..10` directly, `11..266` through `ip->addrs[NDIRECT]`, and `267..65802` through two levels of indirection rooted at `ip->addrs[NDIRECT+1]` (`bn / NINDIRECT` for the L1 entry, `bn % NINDIRECT` for the L2 entry), lazily allocating and logging missing blocks via `balloc()` + `log_write()`.
  - `itrunc()` frees direct blocks, singly-indirect data + table block, and all doubly-indirect L2 data blocks, L1 indirect blocks, and the doubly-indirect root block directly from buffer cache entries (single read of the doubly-indirect root block, zero large stack buffers).
- **Performance optimizations applied (reducing `bigfile` from ~50 min to 3.5 min):**
  - Fixed a `wfi` lost-wakeup race in `scheduler()` (`kernel/proc.c`) by scanning `proc[]` with interrupts disabled before `wfi`, eliminating up to 100 ms stalls per disk interrupt.
  - Added `bget_overwrite()` (`kernel/bio.c`, `kernel/defs.h`) and used it in `bzero()` (`kernel/fs.c`) and `write_log()` (`kernel/log.c`) to avoid wasted disk reads before full-block overwrites; skipped redundant log reads during normal `install_trans(0)` (`kernel/log.c`).
  - Added a next-fit cursor `balloc_hint` and full-byte (`0xff`) skipping in `balloc()`/`bfree()` (`kernel/fs.c`).
  - Enabled deferred group-commit logging in `begin_op()`/`end_op()` with `log_flush()` on `exit()`, `sys_unlink()`, and `O_TRUNC` (`kernel/log.c`, `kernel/proc.c`, `kernel/sysfile.c`), and increased `NBUF` to `128` (`kernel/param.h`).

### 3.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| Inode layout, `mkfs`, capacity constants | `kernel/fs.h`, `kernel/file.h`, `kernel/param.h`, `mkfs/mkfs.c` | `sizeof(struct dinode) == 64`, `MAXFILE == 65803`, `fs.img` = 200,000 blocks |
| Doubly-indirect `bmap()` & `itrunc()` | `kernel/fs.c` | `bigfile` **PASS (214.0 s)**; `rm big.file` **PASS (5.3 s)** |
| Fast smoke test & full test | `user/bigfile.c`, `user/bigfiledemo.c` | `bigfiledemo` (512 blocks) **PASS (1.9 s)** |
| Filesystem regression checks | `usertests` (`truncate1–3`, `writetest`, `openiput`, `exitiput`, `iput`, `dirfile`, `iref`, `createdelete`, `opentest`) | **ALL PASSED** |

### 3.4 Edge Cases Fixed
1. **Fixed — Kernel stack usage & redundant `bread()` calls in `itrunc()` (`kernel/fs.c`):** Removed the 1 KB `uint indirect[NINDIRECT]` stack array and refactored the doubly-indirect loop to read `ip->addrs[NDIRECT+1]` once outside the loop.
2. **Fixed — Doubly-indirect support in `mkfs/mkfs.c`:** Extended `iappend()` to handle doubly-indirect blocks up to `MAXFILE`.

---

## 4. Task 2B — File-System Enhancements: Symbolic Links

### 4.1 Requirement Summary
Add symbolic links (`symlink(char *target, char *path)`) that store a target pathname in a dedicated inode type and resolve it dynamically when opened via `open()`, returning `0` on success and `-1` on failure.

### 4.2 How It Is Implemented
- **Types, flags & syscall wiring:**
  - Added `T_SYMLINK 4` (`kernel/stat.h`) and `O_NOFOLLOW 0x800` (`kernel/fcntl.h`).
  - Registered `SYS_symlink` (24) across `kernel/syscall.h`, `kernel/syscall.c`, `user/usys.pl`, and `user/user.h`.
- **Creating symbolic links (`kernel/sysfile.c`):**
  - `sys_symlink()` fetches `target` and `path` before starting the FS transaction, creates a `T_SYMLINK` inode via `create(path, T_SYMLINK, 0, 0)`, and writes the `target` bytes via `writei()` (rolling back and unlinking the created directory entry if `writei()` fails).
- **Following symbolic links on `open()` (`kernel/sysfile.c`):**
  - After locating the initial inode in `sys_open()`, while `ip->type == T_SYMLINK && !(omode & O_NOFOLLOW)`, the kernel reads the target path via `readi()`, unlocks/puts the symlink inode, resolves `target` via `namei(target)`, and repeats up to depth `10` (returning `-1` on cycles, dangling links, empty targets, or oversized paths).
  - `O_NOFOLLOW` bypasses resolution while still allowing read-only opens of directories (`(omode & ~O_NOFOLLOW) != O_RDONLY`).

### 4.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| `T_SYMLINK` & `O_NOFOLLOW` definitions | `kernel/stat.h`, `kernel/fcntl.h` | Verified via `fstat` with `O_NOFOLLOW` |
| `sys_symlink()` & `sys_open()` resolution | `kernel/sysfile.c` | `symlinktest` (`symlinks` + `concurrent symlinks`) **PASS (5.6 s)** |
| Test binary | `user/symlinktest.c` | Chains, cycles, dangling links, > `NINODE` links, concurrent create/unlink |

### 4.4 Edge Cases Fixed & Scope Notes
1. **Fixed — `open(dir, O_RDONLY | O_NOFOLLOW)` (`kernel/sysfile.c`):** Changed directory mode check to `(omode & ~O_NOFOLLOW) != O_RDONLY`; verified read-only directory open with `O_NOFOLLOW` succeeds while `O_RDWR | O_NOFOLLOW` still fails.
2. **Fixed — `sys_symlink()` transaction ordering & error rollback (`kernel/sysfile.c`):** Moved `argstr()` before `begin_op()` and added clean rollback (clearing dirent and decrementing `nlink`) if `writei()` fails.
3. **Note (MIT 6.1810 scope):** Symlink resolution is performed in `sys_open()` rather than intermediate path components inside `namex()`, matching the MIT 6.1810 lab specification where `link`/`unlink` operate on the symlink itself and intermediate directory symlinks are out of scope.

---

## 5. Task 3 — Memory-Mapped Files (`mmap` & `munmap`)

### 5.1 Requirement Summary
Implement file-backed virtual memory mappings via `mmap(addr, len, prot, flags, fd, offset)` and `munmap(addr, len)` with lazy demand paging in `usertrap()`, `PROT_READ`/`PROT_WRITE`, `MAP_SHARED`/`MAP_PRIVATE`, full/start/end `munmap()` with dirty write-back, `exit()`/`exec()` cleanup, and VMA/reference preservation across `fork()`.

### 5.2 How It Is Implemented
- **Constants & VMA metadata (`kernel/fcntl.h`, `kernel/param.h`, `kernel/proc.h`, `kernel/riscv.h`, `user/user.h`):**
  - Defined `PROT_READ`, `PROT_WRITE`, `MAP_SHARED`, `MAP_PRIVATE` in `kernel/fcntl.h`, `NVMA 16` in `kernel/param.h`, `PTE_D (1L << 7)` in `kernel/riscv.h`, and 64-bit `size_t`/`off_t` (`uint64`/`long`) in `user/user.h`.
  - Added `struct vma { addr, len, offset, prot, flags, used, file }` and per-process `mmap_base` + `vmas[NVMA]` in `kernel/proc.h`.
- **Mapping creation & virtual address allocation (`kernel/sysfile.c`, `kernel/proc.c`):**
  - `sys_mmap()` validates arguments and file permissions, searches downward from `TRAPFRAME - PGSIZE` for the highest free non-overlapping gap of size `PGROUNDUP(len)` above `PGROUNDUP(p->sz) + PGSIZE` (automatically reclaiming unmapped VA ranges), duplicates `f` via `filedup(f)`, and records the VMA lazily without allocating physical pages.
  - `growproc()` (`kernel/proc.c`) verifies `sbrk()` growth does not overflow or overlap the lowest active VMA.
- **Lazy demand paging, `copyout` dirty tracking & deadlock-free syscall I/O (`kernel/trap.c`, `kernel/vm.c`, `kernel/file.c`):**
  - `usertrap()` handles load (`scause == 13`) and store (`scause == 15`) page faults via `vm_fault()`, which checks VMA permissions, allocates a zeroed page, reads file data at `v->offset + (pageva - v->addr)`, and maps it via `mappages()`.
  - `vm_prefault()` (`kernel/vm.c`) is invoked in `fileread()` and `filewrite()` (`kernel/file.c`) *before* acquiring `ilock(f->ip)`, faulting in any overlapping VMA pages lock-free to prevent same-file and AB-BA inode sleeplock deadlocks.
  - `copyout()` sets `*pte |= PTE_D` after verifying writability so kernel writes (e.g., `read()` into a `MAP_SHARED` buffer) are properly written back on `munmap()`/`exit()`.
- **Unmapping, write-back & process lifecycle (`kernel/sysfile.c`, `kernel/vm.c`, `kernel/proc.c`, `kernel/exec.c`):**
  - `sys_munmap()` rounds non-page-aligned `len` up via `PGROUNDUP(len)` (checking overflow) and calls `vm_unmap()`, which writes back dirty (`PTE_D`) `MAP_SHARED` pages inside per-page transactions, unmaps pages via `uvmunmap()`, and removes or trims the VMA.
  - `exit()` and `exec()` call `vm_unmap_all(p)` (with `exec()` resetting `p->mmap_base = TRAPFRAME - PGSIZE`); `fork()` copies active VMAs and calls `filedup()`; `freeproc()` asserts no active VMAs remain rather than calling sleeping `fileclose()` under `p->lock`.

### 5.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| Flags, PTE dirty bit, VMA table, 64-bit types | `kernel/fcntl.h`, `kernel/riscv.h`, `kernel/proc.h`, `kernel/param.h`, `user/user.h` | Built & verified |
| `sys_mmap()` / `sys_munmap()` with gap reuse & alignment | `kernel/sysfile.c`, `user/usys.pl` | `mmaptest` (all 11 subtests) **PASS (0.5 s)** |
| Demand paging, `vm_prefault`, `PTE_D` write-back & lifecycle | `kernel/trap.c`, `kernel/vm.c`, `kernel/file.c`, `kernel/proc.c`, `kernel/exec.c` | All edge cases verified live in QEMU |
| Test binary | `user/mmaptest.c` | `mmaptest: all tests succeeded` |

### 5.4 Edge Cases Fixed & Hardware Notes
1. **Fixed — Non-page-aligned `munmap()` `len` (`kernel/sysfile.c`):** Rounded `len` via `PGROUNDUP(len)` with overflow checks; verified `mmap(0, 100, ...)` + `munmap(p, 100)` writes back and succeeds.
2. **Fixed — `exec()` `mmap_base` reset & VA reclamation (`kernel/exec.c`, `kernel/sysfile.c`):** Reset `p->mmap_base = TRAPFRAME - PGSIZE` in `exec()` and replaced monotonic bump allocation in `sys_mmap()` with gap scanning across `vmas[]`; verified VA reuse (`p2 == p1`) after `munmap()`.
3. **Fixed — `growproc()` (`sbrk`) collision check (`kernel/proc.c`):** Guarded `growproc()` against overflow and overlap with the lowest active VMA; verified alongside `usertests` `sbrkbasic`, `sbrkfail`, `MAXVAplus`.
4. **Fixed — `copyout()` `PTE_D` dirty marking (`kernel/vm.c`):** Marked `*pte |= PTE_D` in `copyout()`; verified `read(src_fd, unfaulted_map_shared, 16)` followed by `munmap()` persists the data to disk.
5. **Fixed — Inode lock deadlock on unfaulted `mmap` I/O (`kernel/vm.c`, `kernel/file.c`, `kernel/defs.h`):** Added `vm_prefault()` before `ilock()` in `fileread()`/`filewrite()`; verified same-file `read()` and `write()` on unfaulted mapped buffers complete without deadlocking.
6. **Fixed — Latent spinlock-sleep panic in `freeproc()` (`kernel/proc.c`):** Removed `fileclose()` from `freeproc()` (where `p->lock` is held) and asserted `!p->vmas[i].used`.
7. **Fixed — 64-bit `size_t`/`off_t` (`user/user.h`):** Changed to `typedef uint64 size_t; typedef long off_t;`.
8. **Hardware note (`PROT_WRITE`-only PTEs):** On RISC-V Sv39, a leaf PTE with `PTE_W=1` and `PTE_R=0` is reserved by the architecture and always faults, so `vm_fault()` sets `PTE_R` alongside `PTE_W` while enforcing `PROT_READ` on load faults prior to mapping.

---

## 6. Consolidated Verification Matrix

| Suite / Check | Result | Duration |
| --- | --- | --- |
| `alarmtest` (Task 1, `test0`–`test3`) | **PASS** | 2.9 s |
| `bigfile` (Task 2A, full 65,803 blocks) | **PASS** (`bigfile done; ok`) | 214.0 s |
| `rm big.file` (Task 2A, full 65,803-block `itrunc`) | **PASS** | 5.3 s |
| `bigfiledemo` (Task 2A, 512 blocks) | **PASS** | 1.9 s |
| `symlinktest` (Task 2B, `symlinks` + `concurrent`) | **PASS** | 5.6 s |
| `mmaptest` (Task 3, all 11 subtests) | **PASS** | 0.5 s |
| Edge-case verification suite (all 7 fixes: `alarm+exec`, `dir+O_NOFOLLOW`, non-aligned `munmap` + VA reuse, `copyout` `PTE_D` write-back, same-file unfaulted `read`/`write`, `mmap+exec`, `sbrk` guard) | **ALL PASSED** | 0.8 s |
| `usertests` VM & FS regression checks (`sbrkbasic`, `sbrkfail`, `truncate1–3`, `writetest`, `openiput`, `exitiput`, `iput`, `dirfile`, `iref`, `createdelete`, `opentest`, `badwrite`, `MAXVAplus`) | **ALL PASSED** | — |
