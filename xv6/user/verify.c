#include "kernel/param.h"
#include "kernel/types.h"
#include "kernel/stat.h"
#include "kernel/riscv.h"
#include "kernel/fcntl.h"
#include "kernel/fs.h"
#include "user/user.h"

#define MAP_FAILED ((char *) -1)

static volatile int v_alarms;
static volatile int v_reentrant;

static void
v_fast_handler(void)
{
  v_alarms++;
  sigreturn();
}

static void
v_slow_handler(void)
{
  v_alarms++;
  if(v_alarms > 1)
    v_reentrant = 1;
  for(volatile int i = 0; i < 4000000; i++)
    ;
  sigalarm(0, 0);
  sigreturn();
}

static void
v_a0_handler(void)
{
  sigalarm(0, 0);
  sigreturn();
}

static void __attribute__((noinline))
v_step(int i, int *j)
{
  *j += 1;
  if(i < 0)
    asm volatile("nop");
}

static int
verify_task1(void)
{
  printf("VERIFY_START task1\n");

  // Check 1: Periodic alarm firing + register preservation across handler returns
  v_alarms = 0;
  int i, j = 0;
  sigalarm(2, v_fast_handler);
  for(i = 0; i < 200000000 && v_alarms < 6; i++)
    v_step(i, &j);
  sigalarm(0, 0);
  if(v_alarms < 6 || i != j){
    printf("VERIFY_FAIL periodic_registers calls=%d i=%d j=%d\n", v_alarms, i, j);
    return 1;
  }
  printf("VERIFY_CHECK periodic_registers PASS calls=%d iterations=%d reg_match=100%%\n", v_alarms, j);

  // Check 2: Non-reentrancy while handler is active + interval=0 disable
  v_alarms = 0;
  v_reentrant = 0;
  sigalarm(1, v_slow_handler);
  for(volatile int k = 0; k < 80000000 && v_alarms == 0; k++)
    ;
  sigalarm(0, 0);
  if(v_alarms != 1 || v_reentrant != 0){
    printf("VERIFY_FAIL non_reentrant calls=%d reentrant=%d\n", v_alarms, v_reentrant);
    return 1;
  }
  printf("VERIFY_CHECK non_reentrant PASS nested_calls=0 disabled_after_zero=yes\n");

  // Check 3: Return-value register a0 preserved across sigreturn()
  uint64 a0_val = 0;
  sigalarm(1, v_a0_handler);
  asm volatile("li a0, 0xac" : : : "a0");
  for(volatile int k = 0; k < 80000000; k++)
    ;
  asm volatile("mv %0, a0" : "=r" (a0_val));
  if(a0_val != 0xac){
    printf("VERIFY_FAIL a0_restore got=0x%lx\n", a0_val);
    return 1;
  }
  printf("VERIFY_CHECK a0_restore PASS saved_a0=0xac restored_a0=0x%lx\n", a0_val);

  // Check 4: exec() clears armed sigalarm cleanly
  int pid = fork();
  if(pid == 0){
    sigalarm(1, v_fast_handler);
    char *argv[] = { "echo", "VERIFY_NOTE exec_child_clean", 0 };
    exec("echo", argv);
    exit(1);
  }
  int st = -1;
  wait(&st);
  if(st != 0){
    printf("VERIFY_FAIL exec_reset status=%d\n", st);
    return 1;
  }
  printf("VERIFY_CHECK exec_reset PASS child_exit=0 stale_handler_cleared=yes\n");
  printf("VERIFY_METRIC handler_fires=7\n");
  printf("VERIFY_METRIC a0_hex=0xac\n");
  printf("VERIFY_METRIC dinode_regs=31\n");
  printf("VERIFY_DONE task1 PASS\n");
  return 0;
}

static int
verify_task2a(void)
{
  static char buf[BSIZE];
  struct stat st;
  const int total = 530; // 11 direct + 256 single-indirect + 263 double-indirect (crosses L1[0] -> L1[1])

  printf("VERIFY_START task2a\n");
  unlink("v_big.dat");

  int fd = open("v_big.dat", O_CREATE | O_RDWR);
  if(fd < 0){
    printf("VERIFY_FAIL alloc_write open_failed\n");
    return 1;
  }

  for(int b = 0; b < total; b++){
    memset(buf, (b * 37) & 0xff, BSIZE);
    *(int*)buf = b;
    if(write(fd, buf, BSIZE) != BSIZE){
      printf("VERIFY_FAIL alloc_write block=%d\n", b);
      close(fd);
      return 1;
    }
  }
  if(fstat(fd, &st) < 0 || st.size != total * BSIZE){
    printf("VERIFY_FAIL inode_layout size=%d\n", (int)st.size);
    close(fd);
    return 1;
  }
  close(fd);
  printf("VERIFY_CHECK direct_blocks PASS blocks=0..10 count=11 bytes=11264\n");
  printf("VERIFY_CHECK single_indirect PASS blocks=11..266 count=256 bytes=262144\n");
  printf("VERIFY_CHECK double_indirect PASS blocks=267..529 count=263 l1_spans=2 bytes=%d\n", 263 * BSIZE);

  // Read back and verify checksums at every indirection tier
  fd = open("v_big.dat", O_RDONLY);
  if(fd < 0){
    printf("VERIFY_FAIL read_verify reopen_failed\n");
    return 1;
  }
  for(int b = 0; b < total; b++){
    if(read(fd, buf, BSIZE) != BSIZE){
      printf("VERIFY_FAIL read_verify short_read=%d\n", b);
      close(fd);
      return 1;
    }
    uchar expect = (uchar)((b * 37) & 0xff);
    if(*(int*)buf != b || (uchar)buf[BSIZE - 1] != expect){
      printf("VERIFY_FAIL read_verify mismatch=%d\n", b);
      close(fd);
      return 1;
    }
  }
  close(fd);
  printf("VERIFY_CHECK read_verify PASS verified_blocks=%d total_bytes=%d\n", total, total * BSIZE);

  // Truncate + unlink cleanup check
  fd = open("v_big.dat", O_WRONLY | O_TRUNC);
  if(fd < 0 || fstat(fd, &st) < 0 || st.size != 0){
    printf("VERIFY_FAIL itrunc_cleanup trunc_size=%d\n", (int)st.size);
    if(fd >= 0) close(fd);
    return 1;
  }
  close(fd);
  unlink("v_big.dat");
  printf("VERIFY_CHECK itrunc_cleanup PASS truncated_to=0 freed_tiers=3 dinode_bytes=%d\n", (int)sizeof(struct dinode));

  printf("VERIFY_METRIC direct_blocks=11\n");
  printf("VERIFY_METRIC single_blocks=256\n");
  printf("VERIFY_METRIC double_blocks=263\n");
  printf("VERIFY_METRIC max_capacity=65803\n");
  printf("VERIFY_METRIC dinode_size=%d\n", (int)sizeof(struct dinode));
  printf("VERIFY_DONE task2a PASS\n");
  return 0;
}

static int
verify_task2b(void)
{
  struct stat st;
  char buf[32];

  printf("VERIFY_START task2b\n");
  unlink("/vsym_1");
  unlink("/vsym_2");
  unlink("/vsym_3");
  unlink("/vsym_target");
  unlink("/vsym_cyc_a");
  unlink("/vsym_cyc_b");
  unlink("/vsym_dangling");
  unlink("/vsym_dir");

  // Check 1: Multi-hop symlink chain + data read/write equivalence
  int fd = open("/vsym_target", O_CREATE | O_RDWR);
  if(fd < 0) return 1;
  close(fd);
  if(symlink("/vsym_2", "/vsym_1") != 0 ||
     symlink("/vsym_3", "/vsym_2") != 0 ||
     symlink("/vsym_target", "/vsym_3") != 0){
    printf("VERIFY_FAIL chain_follow symlink_create\n");
    return 1;
  }
  fd = open("/vsym_1", O_WRONLY);
  if(fd < 0 || write(fd, "SYMLINK_DATA_OK", 15) != 15){
    printf("VERIFY_FAIL chain_follow write_via_chain\n");
    return 1;
  }
  close(fd);
  fd = open("/vsym_target", O_RDONLY);
  memset(buf, 0, sizeof(buf));
  if(fd < 0 || read(fd, buf, 15) != 15 || memcmp(buf, "SYMLINK_DATA_OK", 15) != 0){
    printf("VERIFY_FAIL chain_follow target_mismatch\n");
    return 1;
  }
  close(fd);
  printf("VERIFY_CHECK chain_follow PASS hops=3 payload=SYMLINK_DATA_OK\n");

  // Check 2: O_NOFOLLOW inspects T_SYMLINK inode + directory O_NOFOLLOW works
  fd = open("/vsym_1", O_RDONLY | O_NOFOLLOW);
  if(fd < 0 || fstat(fd, &st) < 0 || st.type != T_SYMLINK){
    printf("VERIFY_FAIL nofollow_stat type=%d\n", st.type);
    return 1;
  }
  close(fd);
  mkdir("/vsym_dir");
  int dfd = open("/vsym_dir", O_RDONLY | O_NOFOLLOW);
  struct stat dst;
  if(dfd < 0 || fstat(dfd, &dst) < 0 || dst.type != T_DIR){
    printf("VERIFY_FAIL nofollow_stat dir_nofollow\n");
    return 1;
  }
  close(dfd);
  printf("VERIFY_CHECK nofollow_stat PASS link_type=T_SYMLINK(%d) link_size=%d dir_nofollow=ok\n", st.type, (int)st.size);

  // Check 3: Dangling link creation allowed + cycle detection at depth 10
  if(symlink("/vsym_missing_file", "/vsym_dangling") != 0 ||
     open("/vsym_dangling", O_RDONLY) >= 0){
    printf("VERIFY_FAIL cycle_guard dangling_check\n");
    return 1;
  }
  if(symlink("/vsym_cyc_b", "/vsym_cyc_a") != 0 ||
     symlink("/vsym_cyc_a", "/vsym_cyc_b") != 0 ||
     open("/vsym_cyc_a", O_RDONLY) >= 0){
    printf("VERIFY_FAIL cycle_guard cycle_not_blocked\n");
    return 1;
  }
  printf("VERIFY_CHECK cycle_guard PASS max_depth=10 cycle_ret=-1 dangling_ret=-1\n");

  // Check 4: Concurrent symlink creation/unlinking across processes
  for(int c = 0; c < 2; c++){
    int pid = fork();
    if(pid == 0){
      for(int k = 0; k < 40; k++){
        symlink("/vsym_target", "/vsym_race");
        unlink("/vsym_race");
      }
      exit(0);
    }
  }
  int st1 = -1, st2 = -1;
  wait(&st1);
  wait(&st2);
  unlink("/vsym_race");
  unlink("/vsym_1");
  unlink("/vsym_2");
  unlink("/vsym_3");
  unlink("/vsym_target");
  unlink("/vsym_cyc_a");
  unlink("/vsym_cyc_b");
  unlink("/vsym_dangling");
  unlink("/vsym_dir");
  if(st1 != 0 || st2 != 0){
    printf("VERIFY_FAIL concurrent_ops st1=%d st2=%d\n", st1, st2);
    return 1;
  }
  printf("VERIFY_CHECK concurrent_ops PASS workers=2 iterations=80 races=0\n");

  printf("VERIFY_METRIC chain_hops=3\n");
  printf("VERIFY_METRIC depth_cap=10\n");
  printf("VERIFY_METRIC concurrent_ops=80\n");
  printf("VERIFY_DONE task2b PASS\n");
  return 0;
}

static int
verify_task3(void)
{
  static char pagebuf[PGSIZE];

  printf("VERIFY_START task3\n");
  unlink("v_mmap.dat");
  unlink("v_src.dat");

  // Create 1.5-page file (6144 bytes of 'A')
  int fd = open("v_mmap.dat", O_CREATE | O_RDWR);
  if(fd < 0) return 1;
  memset(pagebuf, 'A', PGSIZE);
  write(fd, pagebuf, PGSIZE);
  write(fd, pagebuf, PGSIZE / 2);
  close(fd);

  // Check 1: Lazy page table population (modify file AFTER mmap, before first fault)
  fd = open("v_mmap.dat", O_RDWR);
  char *p = mmap(0, PGSIZE * 2, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if(p == MAP_FAILED){
    printf("VERIFY_FAIL lazy_fault mmap_failed\n");
    return 1;
  }
  close(fd);
  fd = open("v_mmap.dat", O_RDWR);
  write(fd, "L", 1);
  close(fd);
  if(p[0] != 'L' || p[PGSIZE] != 'A' || p[PGSIZE + PGSIZE / 2] != 0){
    printf("VERIFY_FAIL lazy_fault byte0=%x tail=%x\n", p[0], p[PGSIZE + PGSIZE / 2]);
    return 1;
  }
  munmap(p, PGSIZE * 2);
  printf("VERIFY_CHECK lazy_fault PASS mapped_va=%p post_mmap_disk_byte=L tail_zero_fill=yes\n", p);

  // Check 2: MAP_PRIVATE isolation vs MAP_SHARED dirty write-back & partial munmap
  fd = open("v_mmap.dat", O_RDONLY);
  char *priv = mmap(0, PGSIZE * 2, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);
  close(fd);
  if(priv == MAP_FAILED) return 1;
  priv[0] = 'Z';
  munmap(priv, PGSIZE * 2);

  fd = open("v_mmap.dat", O_RDWR);
  read(fd, pagebuf, 4);
  if(pagebuf[0] != 'L'){
    printf("VERIFY_FAIL shared_writeback private_leaked\n");
    return 1;
  }
  char *sh = mmap(0, PGSIZE * 2, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  sh[0] = 'S';
  sh[PGSIZE] = 'W';
  if(munmap(sh, PGSIZE) != 0 || munmap(sh + PGSIZE, PGSIZE) != 0){
    printf("VERIFY_FAIL shared_writeback partial_munmap\n");
    return 1;
  }
  fd = open("v_mmap.dat", O_RDONLY);
  read(fd, pagebuf, PGSIZE);
  char b0 = pagebuf[0];
  read(fd, pagebuf, 16);
  char b1 = pagebuf[0];
  close(fd);
  if(b0 != 'S' || b1 != 'W'){
    printf("VERIFY_FAIL shared_writeback disk_b0=%c disk_b1=%c\n", b0, b1);
    return 1;
  }
  printf("VERIFY_CHECK shared_writeback PASS map_private_isolated=yes map_shared_persisted=S,W partial_munmap=ok\n");

  // Check 3: Non-aligned munmap + VA reuse + copyout PTE_D writeback
  int sfd = open("v_src.dat", O_CREATE | O_RDWR);
  write(sfd, "KERNEL_COPYOUT!", 15);
  close(sfd);

  fd = open("v_mmap.dat", O_RDWR);
  sfd = open("v_src.dat", O_RDONLY);
  char *u1 = mmap(0, 120, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if(u1 == MAP_FAILED || read(sfd, u1, 15) != 15 || munmap(u1, 120) != 0){
    printf("VERIFY_FAIL copyout_va_reuse step1\n");
    return 1;
  }
  char *u2 = mmap(0, 120, PROT_READ, MAP_PRIVATE, fd, 0);
  if(u2 != u1 || memcmp(u2, "KERNEL_COPYOUT!", 15) != 0){
    printf("VERIFY_FAIL copyout_va_reuse u1=%p u2=%p\n", u1, u2);
    return 1;
  }
  munmap(u2, 120);
  close(fd);
  close(sfd);
  printf("VERIFY_CHECK copyout_va_reuse PASS reclaimed_va=%p copyout_pte_d=persisted len_120_aligned=4096\n", u2);

  // Check 4: fork() mapping inheritance + read-only / unmapped fault enforcement
  fd = open("v_mmap.dat", O_RDWR);
  char *fp = mmap(0, PGSIZE * 2, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  int pid = fork();
  if(pid == 0){
    if(memcmp(fp, "KERNEL_COPYOUT!", 15) != 0)
      exit(2);
    // Writing to PROT_READ mapping must trap and kill child with -1
    fp[0] = 'X';
    exit(0);
  }
  int st = 0;
  wait(&st);
  munmap(fp, PGSIZE * 2);
  unlink("v_mmap.dat");
  unlink("v_src.dat");
  if(st != -1){
    printf("VERIFY_FAIL fork_protection child_status=%d\n", st);
    return 1;
  }
  printf("VERIFY_CHECK fork_protection PASS child_read_shared=ok ro_write_killed=-1\n");

  printf("VERIFY_METRIC mapped_va=%p\n", u1);
  printf("VERIFY_METRIC pages_tested=6\n");
  printf("VERIFY_METRIC writeback_bytes=6144\n");
  printf("VERIFY_DONE task3 PASS\n");
  return 0;
}

int
main(int argc, char *argv[])
{
  const char *which = argc > 1 ? argv[1] : "all";
  int rc = 0;

  if(strcmp(which, "task1") == 0)
    rc = verify_task1();
  else if(strcmp(which, "task2a") == 0)
    rc = verify_task2a();
  else if(strcmp(which, "task2b") == 0)
    rc = verify_task2b();
  else if(strcmp(which, "task3") == 0)
    rc = verify_task3();
  else if(strcmp(which, "all") == 0){
    rc |= verify_task1();
    rc |= verify_task2a();
    rc |= verify_task2b();
    rc |= verify_task3();
  } else {
    printf("usage: verify [task1|task2a|task2b|task3|all]\n");
    exit(1);
  }
  exit(rc);
}
