# CS-303 Operating Systems Project Report

**Specification:** `Project (1).pdf` (inspired by MIT 6.1810)  
**Implementation Repository:** `/home/manan/xv6` (branch `project`)  
**Companion Directories:** `/home/manan/xv6-labs-tests` (clean MIT reference tests), `/home/manan/xv6-dashboard` (Flask + React test runner dashboard)

---

## 1. Executive Summary

All three tasks specified in `Project (1).pdf`—**Periodic User-Level Alarms**, **File-System Enhancements (Large Files & Symbolic Links)**, and **Memory-Mapped Files**—are implemented in `/home/manan/xv6` and pass all corresponding MIT 6.1810 verification suites (`alarmtest`, `bigfile`, `bigfiledemo`, `symlinktest`, `mmaptest`) as well as targeted `usertests` filesystem regression checks in QEMU.

In addition, kernel-level scheduler and filesystem performance optimizations were applied so that the full 65,803-block `bigfile` write/read verification finishes in **3 min 34 s (214 s)** (down from ~50 minutes), comfortably within MIT's 240 s grading timeout, without modifying `user/bigfile.c` or the on-disk filesystem format.

A thorough code audit also identified **several edge-case bugs** not covered by the standard test suites (detailed per task and consolidated in Section 6) that should be fixed before final submission.

---

## 2. Task 1 — Periodic User-Level Alarms (`sigalarm` & `sigreturn`)

### 2.1 Requirement Summary
Add a periodic CPU-time alarm mechanism that transfers control to a user-registered handler after every `n` hardware timer ticks and seamlessly resumes interrupted user execution without altering observable register state (including `a0`). Calling `sigalarm(0, 0)` must disable future alarms, and alarm delivery must not be re-entrant while a handler is already executing.

### 2.2 How It Is Implemented
- **System-call interface & user stubs:**
  - Assigned `SYS_sigalarm` (22) and `SYS_sigreturn` (23) in `kernel/syscall.h` (`L23-L24`) and registered `sys_sigalarm` / `sys_sigreturn` in `kernel/syscall.c` (`L134-L135`).
  - Added user stubs `entry("sigalarm")` and `entry("sigreturn")` in `user/usys.pl` (`L39-L40`) and declarations in `user/user.h` (`L25-L26`).
- **Per-process kernel bookkeeping (`kernel/proc.h`, `kernel/proc.c`):**
  - Extended `struct proc` (`kernel/proc.h`, `L113-L117`) with:
    - `struct trapframe *alarm_tf` — saved copy of user registers while inside the alarm handler.
    - `int alarm_interval` — configured tick period (`0` disables alarms).
    - `int alarm_ticks` — elapsed timer ticks since the last handler invocation.
    - `int in_handler` — re-entrancy guard (non-zero while executing the handler).
    - `uint64 alarm_handler` — user virtual address of the handler function.
  - `allocproc()` (`kernel/proc.c`, `L135-L143`) allocates `alarm_tf` via `kalloc()` and zeroes all alarm fields. `freeproc()` (`kernel/proc.c`, `L173-L179`) frees `alarm_tf` and resets the fields. Because `fork()` initializes children via `allocproc()`, alarms are not inherited across `fork()`.
- **Alarm configuration & timer-interrupt dispatch (`kernel/sysproc.c`, `kernel/trap.c`):**
  - `sys_sigalarm()` (`kernel/sysproc.c`, `L99-L114`) rejects negative intervals, stores `alarm_interval` and `alarm_handler`, and resets `alarm_ticks = 0`. Passing `interval = 0` disables subsequent alarms while leaving `in_handler` intact so a handler calling `sigalarm(0, 0)` can still finish via `sigreturn()`.
  - In `usertrap()` (`kernel/trap.c`, `L83-L94`), on a timer interrupt (`which_dev == 2`), if `p->alarm_interval > 0 && !p->in_handler`, the kernel increments `p->alarm_ticks`. Once `p->alarm_ticks >= p->alarm_interval`, it snapshots `*p->alarm_tf = *p->trapframe`, redirects `p->trapframe->epc = p->alarm_handler`, sets `p->in_handler = 1`, and resets `p->alarm_ticks = 0`.
- **Context restoration (`kernel/sysproc.c`):**
  - `sys_sigreturn()` (`kernel/sysproc.c`, `L117-L129`) returns `-1` if `!p->in_handler`. Otherwise it restores `*p->trapframe = *p->alarm_tf`, clears `p->in_handler = 0`, and returns `p->trapframe->a0` so `syscall()`'s write-back of the return value into `p->trapframe->a0` preserves the interrupted program's original `a0` register.

### 2.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| Syscall dispatch & user stubs | `kernel/syscall.h`, `kernel/syscall.c`, `user/usys.pl`, `user/user.h` | Built into `kernel/kernel` & `fs.img` |
| Per-process alarm state & lifecycle | `kernel/proc.h`, `kernel/proc.c` | Verified under `alarmtest` |
| Timer trigger & `sigalarm`/`sigreturn` | `kernel/trap.c`, `kernel/sysproc.c` | `alarmtest` `test0`–`test3` **PASS (3.0 s)** |
| Test binary | `user/alarmtest.c` (added to `UPROGS` in `Makefile`) | Single alarm, periodic + register restoration, non-reentrancy, `a0` preservation |

### 2.4 Edge Cases to Be Fixed
1. **`exec()` does not reset alarm state (`kernel/exec.c`, `L123-L131`):**
   - *Issue:* If a process calls `sigalarm(n, handler)` and then calls `exec()`, the old `alarm_handler` virtual address remains armed in the new address space, causing the new program to jump to an invalid/unrelated PC on the next alarm tick.
   - *Fix:* Reset `p->alarm_interval = 0; p->alarm_ticks = 0; p->in_handler = 0; p->alarm_handler = 0;` when committing the new user image in `exec()`.
2. **Looser user-space function signature (`user/user.h`, `L25`):**
   - *Issue:* Declared as `int sigalarm(int, void*);` rather than `int sigalarm(int ticks, void (*handler)());`.
   - *Fix:* Update the prototype in `user/user.h` to `int sigalarm(int, void (*)(void));` (or `void (*)()`) for stricter compile-time type checking.
3. **Full-page allocation per process for `alarm_tf` (`kernel/proc.c`, `L135`):**
   - *Issue:* Uses `kalloc()` (4,096 bytes) to store a 288-byte `struct trapframe`, which can fail unnecessarily under memory exhaustion.
   - *Fix (optional):* Embed `struct trapframe alarm_tf;` directly inside `struct proc` instead of dynamically allocating a separate page.

---

## 3. Task 2A — File-System Enhancements: Large Files

### 3.1 Requirement Summary
Increase the maximum xv6 file size from 268 blocks to **65,803 blocks** while keeping the on-disk `struct dinode` size unchanged (64 bytes): 11 direct block pointers, 1 singly-indirect block pointer (256 blocks), and 1 doubly-indirect block pointer ($256 \times 256 = 65,536$ blocks). Update inode definitions, `bmap()`, `itrunc()`, and rebuild `fs.img`.

### 3.2 How It Is Implemented
- **On-disk & in-memory inode layout (`kernel/fs.h`, `kernel/file.h`, `kernel/param.h`):**
  - Set `NDIRECT 11`, `NINDIRECT (BSIZE / sizeof(uint))` (= 256), and `MAXFILE (NDIRECT + NINDIRECT + NINDIRECT*NINDIRECT)` (= 65,803) in `kernel/fs.h` (`L27-L29`).
  - Changed `addrs` to `uint addrs[NDIRECT+2]` (13 entries = 52 bytes, preserving `sizeof(struct dinode) == 64`) in both `struct dinode` (`kernel/fs.h`, `L38`) and `struct inode` (`kernel/file.h`, `L29`).
  - Increased `FSSIZE` to `200000` blocks (204.8 MB) in `kernel/param.h` (`L16`) and rebuilt `fs.img`.
- **Block mapping & truncation (`kernel/fs.c`):**
  - `bmap()` (`kernel/fs.c`, `L402-L477`) maps blocks `0..10` directly, `11..266` through `ip->addrs[NDIRECT]`, and `267..65802` through two levels of indirection rooted at `ip->addrs[NDIRECT+1]` (`bn / NINDIRECT` for the L1 entry, `bn % NINDIRECT` for the L2 entry), lazily allocating and logging missing blocks via `balloc()` + `log_write()`.
  - `itrunc()` (`kernel/fs.c`, `L482-L534`) frees all direct blocks, singly-indirect data + table block, and all L2 data blocks, L1 indirect blocks, and the doubly-indirect root block, then zeroes `ip->size` and calls `iupdate(ip)`.
- **Performance optimizations applied (reducing `bigfile` from ~50 min to 3.5 min):**
  - Fixed a `wfi` lost-wakeup race in `scheduler()` (`kernel/proc.c`, `L486-L517`) by scanning `proc[]` with interrupts disabled before `wfi`, eliminating up to 100 ms stalls per disk interrupt.
  - Added `bget_overwrite()` (`kernel/bio.c`, `L105-L114`; `kernel/defs.h`, `L15`) and used it in `bzero()` (`kernel/fs.c`, `L53-L61`) and `write_log()` (`kernel/log.c`, `L213-L225`) to avoid disk reads before full-block overwrites; skipped redundant log reads during normal `install_trans(0)` (`kernel/log.c`, `L69-L84`).
  - Added a next-fit cursor `balloc_hint` and full-byte (`0xff`) skipping in `balloc()`/`bfree()` (`kernel/fs.c`, `L68-L120`).
  - Enabled deferred group-commit logging in `begin_op()`/`end_op()` with `log_flush()` on `exit()`, `sys_unlink()`, and `O_TRUNC` (`kernel/log.c`, `L129-L202`; `kernel/proc.c`, `L402`; `kernel/sysfile.c`, `L197`, `L320`), and increased `NBUF` to `128` (`kernel/param.h`, `L15`).

### 3.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| Inode layout & capacity constants | `kernel/fs.h`, `kernel/file.h`, `kernel/param.h` | `sizeof(struct dinode) == 64`, `MAXFILE == 65803`, `fs.img` = 200,000 blocks |
| Doubly-indirect `bmap()` & `itrunc()` | `kernel/fs.c` | `bigfile` **PASS (214.0 s)**; `rm big.file` **PASS (5.3 s)** |
| Fast smoke test & full test | `user/bigfile.c`, `user/bigfiledemo.c` | `bigfiledemo` (512 blocks) **PASS (1.8 s)** |
| Filesystem regression checks | `usertests` (`truncate1–3`, `writetest`, `openiput`, `exitiput`, `iput`, `dirfile`, `iref`, `createdelete`, `opentest`) | **ALL PASSED** |

### 3.4 Edge Cases to Be Fixed
1. **1 KB stack array and redundant `bread()` calls in `itrunc()` (`kernel/fs.c`, `L487-L530`):**
   - *Issue:* `uint indirect[NINDIRECT];` allocates 1,024 bytes on xv6's 4 KB kernel stack (risking stack overflow under deep call stacks), and the doubly-indirect block `addr` is re-read via `bread()`/`brelse()` 256 times inside the outer loop.
   - *Fix:* Iterate directly over the `bread()` buffer pointers (or release/free without copying 1 KB onto the stack) and keep the L1 buffer read outside the inner loop or read only non-zero entries cleanly.
2. **`mkfs/mkfs.c` does not support doubly-indirect blocks (`mkfs/mkfs.c`, `L255-L296`):**
   - *Issue:* `iappend()` only handles direct and singly-indirect blocks (max 267 blocks). Currently safe because the largest binary (`_usertests`) is 178 KB, but any preloaded file > 267 KB would corrupt `indirect[]` on the host.
   - *Fix:* Add the doubly-indirect branch to `iappend()` in `mkfs/mkfs.c` to match `bmap()`.

---

## 4. Task 2B — File-System Enhancements: Symbolic Links

### 4.1 Requirement Summary
Add symbolic links (`symlink(char *target, char *path)`) that store a target pathname in a dedicated inode type and resolve it dynamically when opened via `open()`, returning `0` on success and `-1` on failure.

### 4.2 How It Is Implemented
- **Types, flags & syscall wiring:**
  - Added `T_SYMLINK 4` (`kernel/stat.h`, `L4`) and `O_NOFOLLOW 0x800` (`kernel/fcntl.h`, `L6`).
  - Registered `SYS_symlink` (24) across `kernel/syscall.h`, `kernel/syscall.c`, `user/usys.pl`, and `user/user.h`.
- **Creating symbolic links (`kernel/sysfile.c`, `L401-L426`):**
  - `sys_symlink()` reads `target` and `path`, creates a `T_SYMLINK` inode via `create(path, T_SYMLINK, 0, 0)`, and writes the `target` pathname bytes into the symlink inode's data blocks via `writei()`. Because it does not look up `target`, symlinks to nonexistent files succeed as required.
- **Following symbolic links on `open()` (`kernel/sysfile.c`, `L339-L358`):**
  - After obtaining the initial inode in `sys_open()`, while `ip->type == T_SYMLINK && !(omode & O_NOFOLLOW)`, the kernel reads the target path via `readi()`, unlocks/puts the symlink inode, resolves the target via `namei(target)`, and repeats up to a maximum depth of `10` (returning `-1` on cycles, dangling links, empty targets, or paths >= `MAXPATH`).
  - `O_NOFOLLOW` bypasses resolution so callers (such as `stat_slink` in `symlinktest.c`) can inspect the symlink inode itself.

### 4.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| `T_SYMLINK` & `O_NOFOLLOW` definitions | `kernel/stat.h`, `kernel/fcntl.h` | Verified via `fstat` with `O_NOFOLLOW` |
| `sys_symlink()` & `sys_open()` resolution | `kernel/sysfile.c` | `symlinktest` (`symlinks` + `concurrent symlinks`) **PASS (5.8 s)** |
| Test binary | `user/symlinktest.c` | Chains, cycles, dangling links, > `NINODE` links, concurrent create/unlink |

### 4.4 Edge Cases to Be Fixed
1. **`open(dir, O_RDONLY | O_NOFOLLOW)` erroneously fails (`kernel/sysfile.c`, `L360`):**
   - *Issue:* Line 360 checks `if(ip->type == T_DIR && omode != O_RDONLY)`. Combining `O_RDONLY` (0) with `O_NOFOLLOW` (`0x800`) makes `omode != O_RDONLY`, causing read-only `O_NOFOLLOW` opens of directories to return `-1`.
   - *Fix:* Check write/modification flags explicitly: `if(ip->type == T_DIR && (omode & (O_WRONLY | O_RDWR | O_TRUNC | O_CREATE)))` (or check `(omode & ~O_NOFOLLOW) != O_RDONLY`).
2. **Intermediate directory symlinks are not resolved (`kernel/fs.c`, `namex()`):**
   - *Issue:* Symlink following is only implemented in `sys_open()`, not during path traversal in `namex()`. Opening `/symlink_to_dir/file` fails (acceptable under MIT 6.1810's lab scope, though `Project (1).pdf` mentions symlinks to directories).
   - *Fix (optional):* Follow `T_SYMLINK` components in `namex()` (with a recursion depth cap) when traversing non-final path segments.
3. **Minor `sys_symlink()` transaction ordering & error cleanup (`kernel/sysfile.c`, `L409-L422`):**
   - *Issue:* `argstr()` is called inside `begin_op()`, and if `writei()` fails (e.g., disk full), the empty symlink directory entry is left behind.
   - *Fix:* Fetch `argstr(0, ...)` and `argstr(1, ...)` before `begin_op()`, and clean up/unlink the created entry if `writei()` fails.

---

## 5. Task 3 — Memory-Mapped Files (`mmap` & `munmap`)

### 5.1 Requirement Summary
Implement file-backed virtual memory mappings via `mmap(addr, len, prot, flags, fd, offset)` and `munmap(addr, len)`:
- Kernel chooses virtual address when `addr == 0` (returns `0xffffffffffffffff` / `MAP_FAILED` on error).
- Supports `PROT_READ`, `PROT_WRITE`, `MAP_SHARED`, and `MAP_PRIVATE` (`offset == 0`).
- **Lazy demand paging:** `mmap()` records metadata only; physical pages are allocated and populated from the file on page faults in `usertrap()`.
- **Unmapping & write-back:** `munmap()` supports full, start, and end unmaps; modified `MAP_SHARED` pages are written back to the file.
- **Process lifecycle:** Equivalent cleanup on `exit()` (and `exec()`), and preservation of mapping metadata and file references across `fork()`.

### 5.2 How It Is Implemented
- **Constants & VMA metadata (`kernel/fcntl.h`, `kernel/param.h`, `kernel/proc.h`, `kernel/riscv.h`):**
  - Defined `PROT_READ` (`0x1`), `PROT_WRITE` (`0x2`), `MAP_SHARED` (`0x1`), `MAP_PRIVATE` (`0x2`) in `kernel/fcntl.h` (`L8-L11`), `NVMA 16` in `kernel/param.h` (`L17`), and `PTE_D (1L << 7)` in `kernel/riscv.h` (`L378`).
  - Added `struct vma { addr, len, offset, prot, flags, used, file }` (`kernel/proc.h`, `L33-L41`) and per-process `mmap_base` (initialized to `TRAPFRAME - PGSIZE` in `allocproc()`) plus `struct vma vmas[NVMA]` (`kernel/proc.h`, `L118-L119`).
- **Mapping creation (`kernel/sysfile.c`, `L428-L475`):**
  - `sys_mmap()` validates arguments (`addr == 0`, `len > 0`, `offset == 0`, valid `prot`/`flags`, regular readable `FD_INODE` file, and `f->writable` when `MAP_SHARED | PROT_WRITE`).
  - Allocates a downward-growing page-aligned range `[mmap_base - PGROUNDUP(len), mmap_base)` above `PGROUNDUP(p->sz) + PGSIZE`, duplicates the file reference via `filedup(f)`, records the VMA slot, and returns `mapaddr` without allocating physical memory.
- **Lazy page-fault handling (`kernel/trap.c`, `kernel/vm.c`):**
  - `usertrap()` (`kernel/trap.c`, `L70-L72`) intercepts load (`scause == 13`) and store (`scause == 15`) page faults and invokes `vm_fault(p->pagetable, r_stval(), r_scause() == 15)`, killing the process on failure.
  - `vm_fault()` (`kernel/vm.c`, `L134-L187`) locates the VMA containing `va`, checks read/write permissions against `v->prot`, allocates a zeroed physical page with `kalloc()`, reads up to `PGSIZE` bytes from `v->file->ip` at `v->offset + (pageva - v->addr)`, and maps it with `mappages()`.
  - `copyin()`, `copyout()`, and `copyinstr()` (`kernel/vm.c`, `L496-L565`) also call `vm_fault()` so syscalls referencing unfaulted mapped buffers can fault them in.
- **Unmapping, write-back & lifecycle (`kernel/sysfile.c`, `kernel/vm.c`, `kernel/proc.c`, `kernel/exec.c`):**
  - `sys_munmap()` (`kernel/sysfile.c`, `L478-L495`) finds the matching VMA and delegates to `vm_unmap()` (`kernel/vm.c`, `L190-L244`), which validates start/end/full unmaps, writes dirty (`PTE_D`) `MAP_SHARED` pages back to disk via `writei()` inside per-page `begin_op()`/`end_op()` transactions, frees page-table entries via `uvmunmap()`, and either closes `v->file` and frees the VMA slot or trims `v->addr`/`v->len`/`v->offset`.
  - `uvmunmap()` and `uvmcopy()` (`kernel/vm.c`, `L315-L318`, `L449-L452`) skip unmapped PTEs instead of panicking so lazily populated regions work cleanly.
  - `exit()` (`kernel/proc.c`, `L387`) and `exec()` (`kernel/exec.c`, `L124`) call `vm_unmap_all(p)`. `fork()` (`kernel/proc.c`, `L330-L336`) copies `mmap_base` and all active VMAs while incrementing file reference counts with `filedup()`.

### 5.3 Major Deliverables
| Deliverable | Location | Verification |
| --- | --- | --- |
| Flags, PTE dirty bit, VMA table | `kernel/fcntl.h`, `kernel/riscv.h`, `kernel/proc.h`, `kernel/param.h` | Built & verified |
| `sys_mmap()` / `sys_munmap()` | `kernel/sysfile.c`, `user/usys.pl`, `user/user.h` | `mmaptest` (all 11 subtests) **PASS (0.5 s)** |
| Demand paging, write-back & cleanup | `kernel/trap.c`, `kernel/vm.c`, `kernel/proc.c`, `kernel/exec.c` | Covers basic, private, read-only, dirty write-back, partial unmap, lazy load, two files, fork, unmap fault, write-to-RO fault |
| Test binary | `user/mmaptest.c` | `mmaptest: all tests succeeded` |

### 5.4 Edge Cases to Be Fixed
1. **High — `munmap()` rejects non-page-aligned `len` (`kernel/sysfile.c`, `L485-L486`; `kernel/vm.c`, `L196-L198`):**
   - *Issue:* `sys_mmap()` accepts non-page-aligned lengths by rounding up with `PGROUNDUP(len)` (e.g., `mmap(0, 100, ...)` maps 4,096 bytes), but `sys_munmap()` rejects `(len & (PGSIZE-1)) != 0` with `-1`, breaking `munmap(p, 100)`.
   - *Fix:* Round `len` up via `len = PGROUNDUP(len)` (checking for wraparound) in `sys_munmap()` before calling `vm_unmap()`.
2. **High — `exec()` does not reset `p->mmap_base` (`kernel/exec.c`, `L124`):**
   - *Issue:* `exec()` calls `vm_unmap_all(p)` to clear old VMAs, but never resets `p->mmap_base = TRAPFRAME - PGSIZE`. After `exec()`, the new program inherits the old process's lowered `mmap_base` (and `munmap()` never reclaims address space either).
   - *Fix:* Set `p->mmap_base = TRAPFRAME - PGSIZE;` right after `vm_unmap_all(p);` in `exec()`, and ideally scan existing VMAs in `sys_mmap()` to reuse freed address gaps.
3. **High — `growproc()` (`sbrk`) does not check collision with `mmap` regions (`kernel/proc.c`, `L285-L300`):**
   - *Issue:* Growing the user heap via `sbrk()` does not check whether `sz + n` overlaps `p->mmap_base` or any active VMA, which can collide with mapped pages and trigger `panic("mappages: remap")`.
   - *Fix:* Reject `n > 0` in `growproc()` if `PGROUNDUP(sz + n) + PGSIZE > lowest_vma_addr` (or `p->mmap_base`).
4. **High — `copyout()` into a `MAP_SHARED` page never sets `PTE_D` (`kernel/vm.c`, `L496-L515`):**
   - *Issue:* Kernel writes to a `MAP_SHARED` buffer (e.g., `read(fd, mmap_ptr, n)`) write through the kernel direct map rather than the user PTE, so hardware never sets `PTE_D`. On `munmap()`/`exit()`, `vm_unmap()` sees `!(*pte & PTE_D)` and silently drops the modifications.
   - *Fix:* Set `*pte |= PTE_D;` in `copyout()` after validating `*pte` is writable.
5. **High — Potential inode sleeplock deadlock on `read()`/`write()` with an unfaulted `mmap` buffer (`kernel/vm.c`, `L499-L561`):**
   - *Issue:* `copyin()`/`copyout()` call `vm_fault()` -> `ilock(v->file->ip)` while `fileread()`/`filewrite()` already holds `ilock(f->ip)`. Reading or writing a file using an unfaulted mapping of the same file immediately self-deadlocks (and two processes cross-reading two mapped files can AB-BA deadlock).
   - *Fix:* Pre-fault user buffers outside `ilock()` (or avoid holding two inode locks simultaneously in `fileread()`/`filewrite()`).
6. **Medium — Latent spinlock-sleep panic in `freeproc()` (`kernel/proc.c`, `L181-L185`):**
   - *Issue:* `freeproc()` is called with spinlock `p->lock` held, yet calls `fileclose(p->vmas[i].file)`, which can sleep in `begin_op()`/`iput()` (`panic("sched locks")`). Currently unreached only because `exit()` clears VMAs beforehand and `fork()` fails before copying VMAs.
   - *Fix:* Remove `fileclose()` from `freeproc()` (ensure all callers clean up VMAs before acquiring `p->lock` and assert `!p->vmas[i].used` in `freeproc()`).
7. **Low — `PROT_WRITE`-only mapping & 32-bit `size_t`/`off_t` (`kernel/vm.c`, `L179`; `kernel/sysfile.c`, `L447`; `user/user.h`, `L28-L29`):**
   - *Issue:* `vm_fault()` unconditionally sets `PTE_R` (so a `PROT_WRITE`-only mapping becomes readable after a write fault, and `sys_mmap()` rejects `O_WRONLY` descriptors); `user/user.h` typedefs `size_t` as 32-bit `uint` and `off_t` as 32-bit `int` instead of 64-bit `uint64`/`long`.
   - *Fix:* Use `typedef uint64 size_t;` and `typedef long off_t;` in `user/user.h` to match the 64-bit RISC-V ABI and `argaddr()`.

---

## 6. Consolidated Verification & Pre-Submission Checklist

### Verification Summary (Current Build)
| Suite / Command | Result | Duration |
| --- | --- | --- |
| `alarmtest` (Task 1) | **PASS** (`test0`–`test3`) | 3.0 s |
| `bigfile` (Task 2A, full 65,803 blocks) | **PASS** (`bigfile done; ok`) | 214.0 s |
| `rm big.file` (Task 2A, full `itrunc`) | **PASS** | 5.3 s |
| `bigfiledemo` (Task 2A, 512 blocks) | **PASS** | 1.8 s |
| `symlinktest` (Task 2B) | **PASS** (`symlinks` + `concurrent symlinks`) | 5.8 s |
| `mmaptest` (Task 3, 11 subtests) | **PASS** (`all tests succeeded`) | 0.5 s |
| `usertests` targeted FS & VM checks | **PASS** (`truncate1–3`, `writetest`, `openiput`, `exitiput`, `iput`, `dirfile`, `iref`, `createdelete`, `opentest`, `sbrk*`, `copyin/out`) | — |

### Prioritized Action Items Before Final Submission
1. **Fix high-impact Task 3 edge cases:** Round `len` up in `sys_munmap()`, reset `p->mmap_base` in `exec()`, guard `growproc()` against VMA overlap, set `PTE_D` in `copyout()`, and remove `fileclose()` from `freeproc()`.
2. **Fix Task 1 & 2B edge cases:** Clear alarm fields in `exec()`, and fix `open(dir, O_RDONLY | O_NOFOLLOW)` in `sys_open()`.
3. **Clean up Task 2A edge cases:** Eliminate the 1 KB stack buffer in `itrunc()` and add doubly-indirect support to `mkfs/mkfs.c`.
4. **Commit changes to git:** All modifications and test files in `/home/manan/xv6` are currently uncommitted on branch `project`; commit them cleanly before packaging or grading.
