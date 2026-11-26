#include "kernel/types.h"
#include "kernel/stat.h"
#include "user/user.h"
#include "kernel/fcntl.h"
#include "kernel/fs.h"

#define DEMO_BLOCKS 512
#define DEMO_FILE "bigdemo"

int
main()
{
  char buf[BSIZE];
  int fd, i;

  unlink(DEMO_FILE);
  fd = open(DEMO_FILE, O_CREATE | O_WRONLY);
  if(fd < 0){
    printf("bigfiledemo: cannot open %s for writing\n", DEMO_FILE);
    exit(1);
  }

  printf("bigfiledemo: writing %d blocks\n", DEMO_BLOCKS);
  for(i = 0; i < DEMO_BLOCKS; i++){
    memset(buf, i & 0xff, sizeof(buf));
    *(int*)buf = i;
    if(write(fd, buf, sizeof(buf)) != sizeof(buf)){
      printf("bigfiledemo: write failed at block %d\n", i);
      close(fd);
      exit(1);
    }
    if((i + 1) % 64 == 0)
      printf("wrote %d / %d blocks\n", i + 1, DEMO_BLOCKS);
  }

  if(close(fd) < 0){
    printf("bigfiledemo: close after write failed\n");
    exit(1);
  }

  fd = open(DEMO_FILE, O_RDONLY);
  if(fd < 0){
    printf("bigfiledemo: cannot reopen %s for reading\n", DEMO_FILE);
    exit(1);
  }

  printf("bigfiledemo: reading and verifying blocks\n");
  for(i = 0; i < DEMO_BLOCKS; i++){
    if(read(fd, buf, sizeof(buf)) != sizeof(buf)){
      printf("bigfiledemo: read failed at block %d\n", i);
      close(fd);
      exit(1);
    }
    if(*(int*)buf != i || (uchar)buf[BSIZE - 1] != (uchar)(i & 0xff)){
      printf("bigfiledemo: data mismatch at block %d\n", i);
      close(fd);
      exit(1);
    }
  }

  close(fd);
  unlink(DEMO_FILE);
  printf("bigfiledemo: PASS (512 blocks; double-indirect mapping verified)\n");
  exit(0);
}
