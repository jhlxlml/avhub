-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

Format: 3.0 (quilt)
Source: gcc-13
Binary: gcc-13-base, libgcc-s1, libgcc-s2, libgcc-s4, libgcc-13-dev, lib64gcc-s1, lib64gcc-13-dev, lib32gcc-s1, lib32gcc-13-dev, libn32gcc-s1, libn32gcc-13-dev, libx32gcc-s1, libx32gcc-13-dev, gcc-13, gcc-13-multilib, gcc-13-test-results, gcc-13-plugin-dev, gcc-13-hppa64-linux-gnu, cpp-13, cpp-13-doc, gcc-13-locales, g++-13, g++-13-multilib, libgomp1, lib32gomp1, lib64gomp1, libn32gomp1, libx32gomp1, libitm1, lib32itm1, lib64itm1, libx32itm1, libatomic1, lib32atomic1, lib64atomic1, libn32atomic1, libx32atomic1, libasan8, lib32asan8, lib64asan8, libx32asan8, libhwasan0, liblsan0, libtsan2, libubsan1, lib32ubsan1, lib64ubsan1, libx32ubsan1, libquadmath0, lib32quadmath0, lib64quadmath0, libx32quadmath0, libcc1-0, libgccjit0, libgccjit-13-doc, libgccjit-13-dev, gobjc++-13, gobjc++-13-multilib, gobjc-13, gobjc-13-multilib, libobjc-13-dev, lib64objc-13-dev, lib32objc-13-dev, libn32objc-13-dev, libx32objc-13-dev, libobjc4, lib64objc4, lib32objc4, libn32objc4, libx32objc4,
 gfortran-13, gfortran-13-multilib, gfortran-13-doc, libgfortran-13-dev, lib64gfortran-13-dev, lib32gfortran-13-dev, libn32gfortran-13-dev, libx32gfortran-13-dev, libgfortran5, lib64gfortran5, lib32gfortran5, libn32gfortran5, libx32gfortran5, gccgo-13, gccgo-13-multilib, gccgo-13-doc, libgo-13-dev, lib64go-13-dev, lib32go-13-dev, libn32go-13-dev, libx32go-13-dev, libgo22, lib64go22, lib32go22, libn32go22, libx32go22, libstdc++6, lib32stdc++6, lib64stdc++6, libn32stdc++6, libx32stdc++6, libstdc++-13-dev, libstdc++-13-pic, libstdc++6-13-dbg, lib32stdc++-13-dev, lib32stdc++6-13-dbg, lib64stdc++-13-dev, lib64stdc++6-13-dbg, libn32stdc++-13-dev, libn32stdc++6-13-dbg, libx32stdc++-13-dev, libx32stdc++6-13-dbg, libstdc++-13-doc, gnat-13, libgnat-13, gnat-13-doc, gdc-13, gdc-13-multilib, libgphobos-13-dev, lib64gphobos-13-dev, lib32gphobos-13-dev, libn32gphobos-13-dev, libx32gphobos-13-dev, libgphobos4, lib64gphobos4, lib32gphobos4, libn32gphobos4, libx32gphobos4, gm2-13,
 libgm2-13-dev, libgm2-18, gm2-13-doc, gcc-13-doc, gcc-13-offload-nvptx, libgomp-plugin-nvptx1, gcc-13-offload-amdgcn, libgomp-plugin-amdgcn1,
 gcc-13-source
Architecture: any all
Version: 13.2.0-6ubuntu1
Maintainer: Ubuntu Core developers <ubuntu-devel-discuss@lists.ubuntu.com>
Uploaders: Matthias Klose <doko@debian.org>
Homepage: http://gcc.gnu.org/
Standards-Version: 4.6.2
Vcs-Browser: https://salsa.debian.org/toolchain-team/gcc/tree/gcc-13-debian
Vcs-Git: https://salsa.debian.org/toolchain-team/gcc.git -b gcc-13-debian
Testsuite: autopkgtest
Testsuite-Triggers: apt, libc-dev, libc6-dev, python3-minimal
Build-Depends: debhelper (>= 9.20141010), dpkg-dev (>= 1.17.14), g++-multilib [amd64 i386 kfreebsd-amd64 mips mips64 mips64el mips64r6 mips64r6el mipsel mipsn32 mipsn32el mipsn32r6 mipsn32r6el mipsr6 mipsr6el powerpc ppc64 s390 s390x sparc sparc64 x32] <!cross>, libc6.1-dev (>= 2.13-0ubuntu6) [alpha ia64] | libc0.3-dev (>= 2.13-0ubuntu6) [hurd-amd64 hurd-i386] | libc0.1-dev (>= 2.25) [kfreebsd-amd64 kfreebsd-i386] | libc6-dev (>= 2.13-0ubuntu6), libc6-dev-amd64 [i386 x32], libc6-dev-sparc64 [sparc], libc6-dev-sparc [sparc64], libc6-dev-s390 [s390x], libc6-dev-s390x [s390], libc6-dev-i386 [amd64 x32], libc6-dev-powerpc [ppc64], libc6-dev-ppc64 [powerpc], libc0.1-dev-i386 [kfreebsd-amd64], lib32gcc-s1 [amd64 ppc64 kfreebsd-amd64 mipsn32 mipsn32el mips64 mips64el mipsn32r6 mipsn32r6el mips64r6 mips64r6el s390x sparc64 x32], libn32gcc-s1 [mips mipsel mips64 mips64el mipsr6 mipsr6el mips64r6 mips64r6el], lib64gcc-s1 [i386 mips mipsel mipsn32 mipsn32el mipsr6 mipsr6el mipsn32r6 mipsn32r6el powerpc sparc s390 x32], libc6-dev-mips64 [mips mipsel mipsn32 mipsn32el mipsr6 mipsr6el mipsn32r6 mipsn32r6el], libc6-dev-mipsn32 [mips mipsel mips64 mips64el mipsr6 mipsr6el mips64r6 mips64r6el], libc6-dev-mips32 [mipsn32 mipsn32el mips64 mips64el mipsn32r6 mipsn32r6el mips64r6 mips64r6el], libc6-dev-x32 [amd64 i386], libx32gcc-s1 [amd64 i386], libc6.1-dbg [alpha ia64] | libc0.3-dbg [hurd-amd64 hurd-i386] | libc0.1-dbg [kfreebsd-amd64 kfreebsd-i386] | libc6-dbg, kfreebsd-kernel-headers (>= 0.84) [kfreebsd-any], linux-libc-dev [m68k], m4, libtool, autoconf2.69, dwz, libunwind8-dev [ia64], libatomic-ops-dev [ia64], gawk, lzma, xz-utils, patchutils, libzstd-dev, zlib1g-dev, systemtap-sdt-dev [linux-any], binutils:native (>= 2.37), binutils-hppa64-linux-gnu:native (>= 2.37) [hppa amd64 i386 x32], gperf (>= 3.0.1), bison (>= 1:2.3), flex, gettext, gdb:native [!riscv64 !mipsel !mips64el], nvptx-tools [amd64 ppc64el], amdgcn-tools [amd64], texinfo (>= 4.3), locales-all, sharutils, procps, gnat-12:native [!arc !ia64 !loong64 !m32r !sh3 !sh3eb !sh4eb], g++-12:native, netbase, gdc-12:native [!arc !ia64 !loong64 !m68k !sh4 !s390 !sparc64 !alpha !hurd-alpha !hurd-amd64 !hurd-i386 !hurd-alpha !kfreebsd-amd64 !kfreebsd-i386 !kfreebsd-alpha], python3:any, libisl-dev (>= 0.20), libmpc-dev (>= 1.0), libmpfr-dev (>= 3.0.0-9~), libgmp-dev (>= 2:5.0.1~), lib32z1-dev [amd64 kfreebsd-amd64], lib64z1-dev [i386], libx32z1-dev [amd64 kfreebsd-amd64 i386], unzip <!nocheck>, dejagnu <!nocheck>, coreutils (>= 2.26) | realpath (>= 1.9.12), chrpath, lsb-release, quilt, time, pkg-config, libgc-dev, g++-13-alpha-linux-gnu [alpha] <cross>, gobjc-13-alpha-linux-gnu [alpha] <cross>, gfortran-13-alpha-linux-gnu [alpha] <cross>, gdc-13-alpha-linux-gnu [alpha] <cross>, gccgo-13-alpha-linux-gnu [alpha] <cross>, gnat-13-alpha-linux-gnu [alpha] <cross>, gm2-13-alpha-linux-gnu [alpha] <cross>, g++-13-x86-64-linux-gnu [amd64] <cross>, gobjc-13-x86-64-linux-gnu [amd64] <cross>, gfortran-13-x86-64-linux-gnu [amd64] <cross>, gdc-13-x86-64-linux-gnu [amd64] <cross>, gccgo-13-x86-64-linux-gnu [amd64] <cross>, gnat-13-x86-64-linux-gnu [amd64] <cross>, gm2-13-x86-64-linux-gnu [amd64] <cross>, g++-13-arm-linux-gnueabi [armel] <cross>, gobjc-13-arm-linux-gnueabi [armel] <cross>, gfortran-13-arm-linux-gnueabi [armel] <cross>, gdc-13-arm-linux-gnueabi [armel] <cross>, gccgo-13-arm-linux-gnueabi [armel] <cross>, gnat-13-arm-linux-gnueabi [armel] <cross>, gm2-13-arm-linux-gnueabi [armel] <cross>, g++-13-arm-linux-gnueabihf [armhf] <cross>, gobjc-13-arm-linux-gnueabihf [armhf] <cross>, gfortran-13-arm-linux-gnueabihf [armhf] <cross>, gdc-13-arm-linux-gnueabihf [armhf] <cross>, gccgo-13-arm-linux-gnueabihf [armhf] <cross>, gnat-13-arm-linux-gnueabihf [armhf] <cross>, gm2-13-arm-linux-gnueabihf [armhf] <cross>, g++-13-aarch64-linux-gnu [arm64] <cross>, gobjc-13-aarch64-linux-gnu [arm64] <cross>, gfortran-13-aarch64-linux-gnu [arm64] <cross>, gdc-13-aarch64-linux-gnu [arm64] <cross>, gccgo-13-aarch64-linux-gnu [arm64] <cross>, gnat-13-aarch64-linux-gnu [arm64] <cross>, gm2-13-aarch64-linux-gnu [arm64] <cross>, g++-13-i686-linux-gnu [i386] <cross>, gobjc-13-i686-linux-gnu [i386] <cross>, gfortran-13-i686-linux-gnu [i386] <cross>, gdc-13-i686-linux-gnu [i386] <cross>, gccgo-13-i686-linux-gnu [i386] <cross>, gnat-13-i686-linux-gnu [i386] <cross>, gm2-13-i686-linux-gnu [i386] <cross>, g++-13-mipsel-linux-gnu [mipsel] <cross>, gobjc-13-mipsel-linux-gnu [mipsel] <cross>, gfortran-13-mipsel-linux-gnu [mipsel] <cross>, gdc-13-mipsel-linux-gnu [mipsel] <cross>, gccgo-13-mipsel-linux-gnu [mipsel] <cross>, gnat-13-mipsel-linux-gnu [mipsel] <cross>, gm2-13-mipsel-linux-gnu [mipsel] <cross>, g++-13-mips64-linux-gnuabi64 [mips64] <cross>, gobjc-13-mips64-linux-gnuabi64 [mips64] <cross>, gfortran-13-mips64-linux-gnuabi64 [mips64] <cross>, gdc-13-mips64-linux-gnuabi64 [mips64] <cross>, gccgo-13-mips64-linux-gnuabi64 [mips64] <cross>, gnat-13-mips64-linux-gnuabi64 [mips64] <cross>, gm2-13-mips64-linux-gnuabi64 [mips64] <cross>, g++-13-mips64el-linux-gnuabi64 [mips64el] <cross>, gobjc-13-mips64el-linux-gnuabi64 [mips64el] <cross>, gfortran-13-mips64el-linux-gnuabi64 [mips64el] <cross>, gdc-13-mips64el-linux-gnuabi64 [mips64el] <cross>, gccgo-13-mips64el-linux-gnuabi64 [mips64el] <cross>, gnat-13-mips64el-linux-gnuabi64 [mips64el] <cross>, gm2-13-mips64el-linux-gnuabi64 [mips64el] <cross>, g++-13-mips64-linux-gnuabin32 [mipsn32] <cross>, gobjc-13-mips64-linux-gnuabin32 [mipsn32] <cross>, gfortran-13-mips64-linux-gnuabin32 [mipsn32] <cross>, gdc-13-mips64-linux-gnuabin32 [mipsn32] <cross>, gccgo-13-mips64-linux-gnuabin32 [mipsn32] <cross>, gnat-13-mips64-linux-gnuabin32 [mipsn32] <cross>, gm2-13-mips64-linux-gnuabin32 [mipsn32] <cross>, g++-13-powerpc-linux-gnu [powerpc] <cross>, gobjc-13-powerpc-linux-gnu [powerpc] <cross>, gfortran-13-powerpc-linux-gnu [powerpc] <cross>, gdc-13-powerpc-linux-gnu [powerpc] <cross>, gccgo-13-powerpc-linux-gnu [powerpc] <cross>, gnat-13-powerpc-linux-gnu [powerpc] <cross>, g++-13-powerpc64-linux-gnu [ppc64] <cross>, gobjc-13-powerpc64-linux-gnu [ppc64] <cross>, gfortran-13-powerpc64-linux-gnu [ppc64] <cross>, gdc-13-powerpc64-linux-gnu [ppc64] <cross>, gccgo-13-powerpc64-linux-gnu [ppc64] <cross>, gnat-13-powerpc64-linux-gnu [ppc64] <cross>, g++-13-powerpc64le-linux-gnu [ppc64el] <cross>, gobjc-13-powerpc64le-linux-gnu [ppc64el] <cross>, gfortran-13-powerpc64le-linux-gnu [ppc64el] <cross>, gdc-13-powerpc64le-linux-gnu [ppc64el] <cross>, gccgo-13-powerpc64le-linux-gnu [ppc64el] <cross>, gnat-13-powerpc64le-linux-gnu [ppc64el] <cross>, gm2-13-powerpc64le-linux-gnu [ppc64el] <cross>, g++-13-m68k-linux-gnu [m68k] <cross>, gobjc-13-m68k-linux-gnu [m68k] <cross>, gfortran-13-m68k-linux-gnu [m68k] <cross>, gdc-13-m68k-linux-gnu [m68k] <cross>, gm2-13-m68k-linux-gnu [m68k] <cross>, g++-13-riscv64-linux-gnu [riscv64] <cross>, gobjc-13-riscv64-linux-gnu [riscv64] <cross>, gfortran-13-riscv64-linux-gnu [riscv64] <cross>, gdc-13-riscv64-linux-gnu [riscv64] <cross>, gccgo-13-riscv64-linux-gnu [riscv64] <cross>, gnat-13-riscv64-linux-gnu [riscv64] <cross>, gm2-13-riscv64-linux-gnu [riscv64] <cross>, g++-13-sh4-linux-gnu [sh4] <cross>, gobjc-13-sh4-linux-gnu [sh4] <cross>, gfortran-13-sh4-linux-gnu [sh4] <cross>, gnat-13-sh4-linux-gnu [sh4] <cross>, g++-13-sparc64-linux-gnu [sparc64] <cross>, gobjc-13-sparc64-linux-gnu [sparc64] <cross>, gfortran-13-sparc64-linux-gnu [sparc64] <cross>, gdc-13-sparc64-linux-gnu [sparc64] <cross>, gccgo-13-sparc64-linux-gnu [sparc64] <cross>, gnat-13-sparc64-linux-gnu [sparc64] <cross>, gm2-13-sparc64-linux-gnu [sparc64] <cross>, g++-13-s390x-linux-gnu [s390x] <cross>, gobjc-13-s390x-linux-gnu [s390x] <cross>, gfortran-13-s390x-linux-gnu [s390x] <cross>, gdc-13-s390x-linux-gnu [s390x] <cross>, gccgo-13-s390x-linux-gnu [s390x] <cross>, gnat-13-s390x-linux-gnu [s390x] <cross>, gm2-13-s390x-linux-gnu [s390x] <cross>, g++-13-x86-64-linux-gnux32 [x32] <cross>, gobjc-13-x86-64-linux-gnux32 [x32] <cross>, gfortran-13-x86-64-linux-gnux32 [x32] <cross>, gdc-13-x86-64-linux-gnux32 [x32] <cross>, gccgo-13-x86-64-linux-gnux32 [x32] <cross>, gnat-13-x86-64-linux-gnux32 [x32] <cross>, gm2-13-x86-64-linux-gnux32 [x32] <cross>, g++-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, gobjc-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, gfortran-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, gdc-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, gccgo-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, gnat-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, gm2-13-mips64el-linux-gnuabin32 [mipsn32el] <cross>, g++-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, gobjc-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, gfortran-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, gdc-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, gccgo-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, gnat-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, gm2-13-mipsisa32r6-linux-gnu [mipsr6] <cross>, g++-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, gobjc-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, gfortran-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, gdc-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, gccgo-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, gnat-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, gm2-13-mipsisa32r6el-linux-gnu [mipsr6el] <cross>, g++-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, gobjc-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, gfortran-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, gdc-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, gccgo-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, gnat-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, gm2-13-mipsisa64r6-linux-gnuabi64 [mips64r6] <cross>, g++-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, gobjc-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, gfortran-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, gdc-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, gccgo-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, gnat-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, gm2-13-mipsisa64r6el-linux-gnuabi64 [mips64r6el] <cross>, g++-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, gobjc-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, gfortran-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, gdc-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, gccgo-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, gnat-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, gm2-13-mipsisa64r6-linux-gnuabin32 [mipsn32r6] <cross>, g++-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>, gobjc-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>, gfortran-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>, gdc-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>, gccgo-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>, gnat-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>, gm2-13-mipsisa64r6el-linux-gnuabin32 [mipsn32r6el] <cross>
Build-Depends-Indep: doxygen (>= 1.7.2), graphviz (>= 2.2), ghostscript, texlive-latex-base, xsltproc, libxml2-utils, docbook-xsl-ns
Package-List:
 cpp-13 deb interpreters optional arch=any
 cpp-13-doc deb doc optional arch=all
 g++-13 deb devel optional arch=any
 g++-13-multilib deb devel optional arch=amd64,i386,kfreebsd-amd64,mips,mips64,mips64el,mips64r6,mips64r6el,mipsel,mipsn32,mipsn32el,mipsn32r6,mipsn32r6el,mipsr6,mipsr6el,powerpc,ppc64,s390,s390x,sparc,sparc64,x32
 gcc-13 deb devel optional arch=any
 gcc-13-base deb libs optional arch=any
 gcc-13-doc deb doc optional arch=all
 gcc-13-hppa64-linux-gnu deb devel optional arch=hppa,amd64,i386,x32
 gcc-13-locales deb devel optional arch=all
 gcc-13-multilib deb devel optional arch=amd64,i386,kfreebsd-amd64,mips,mips64,mips64el,mips64r6,mips64r6el,mipsel,mipsn32,mipsn32el,mipsn32r6,mipsn32r6el,mipsr6,mipsr6el,powerpc,ppc64,s390,s390x,sparc,sparc64,x32
 gcc-13-offload-amdgcn deb devel optional arch=amd64
 gcc-13-offload-nvptx deb devel optional arch=amd64,ppc64el
 gcc-13-plugin-dev deb devel optional arch=any
 gcc-13-source deb devel optional arch=all
 gcc-13-test-results deb devel optional arch=any
 gccgo-13 deb devel optional arch=any
 gccgo-13-doc deb doc optional arch=all
 gccgo-13-multilib deb devel optional arch=amd64,i386,kfreebsd-amd64,mips,mips64,mips64el,mips64r6,mips64r6el,mipsel,mipsn32,mipsn32el,mipsn32r6,mipsn32r6el,mipsr6,mipsr6el,powerpc,ppc64,s390,s390x,sparc,sparc64,x32
 gdc-13 deb devel optional arch=any
 gdc-13-multilib deb devel optional arch=any
 gfortran-13 deb devel optional arch=any
 gfortran-13-doc deb doc optional arch=all
 gfortran-13-multilib deb devel optional arch=amd64,i386,kfreebsd-amd64,mips,mips64,mips64el,mips64r6,mips64r6el,mipsel,mipsn32,mipsn32el,mipsn32r6,mipsn32r6el,mipsr6,mipsr6el,powerpc,ppc64,s390,s390x,sparc,sparc64,x32
 gm2-13 deb devel optional arch=any
 gm2-13-doc deb doc optional arch=all
 gnat-13 deb devel optional arch=any
 gnat-13-doc deb doc optional arch=all
 gobjc++-13 deb devel optional arch=any
 gobjc++-13-multilib deb devel optional arch=amd64,i386,kfreebsd-amd64,mips,mips64,mips64el,mips64r6,mips64r6el,mipsel,mipsn32,mipsn32el,mipsn32r6,mipsn32r6el,mipsr6,mipsr6el,powerpc,ppc64,s390,s390x,sparc,sparc64,x32
 gobjc-13 deb devel optional arch=any
 gobjc-13-multilib deb devel optional arch=amd64,i386,kfreebsd-amd64,mips,mips64,mips64el,mips64r6,mips64r6el,mipsel,mipsn32,mipsn32el,mipsn32r6,mipsn32r6el,mipsr6,mipsr6el,powerpc,ppc64,s390,s390x,sparc,sparc64,x32
 lib32asan8 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32atomic1 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gcc-13-dev deb libdevel optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gcc-s1 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gfortran-13-dev deb libdevel optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gfortran5 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32go-13-dev deb libdevel optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32go22 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gomp1 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gphobos-13-dev deb libdevel optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32gphobos4 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32itm1 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32objc-13-dev deb libdevel optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32objc4 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32quadmath0 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32stdc++-13-dev deb libdevel optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32stdc++6 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32stdc++6-13-dbg deb debug optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib32ubsan1 deb libs optional arch=amd64,ppc64,kfreebsd-amd64,s390x,sparc64,x32,mipsn32,mipsn32el,mips64,mips64el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el
 lib64asan8 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64atomic1 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gcc-13-dev deb libdevel optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gcc-s1 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gfortran-13-dev deb libdevel optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gfortran5 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64go-13-dev deb libdevel optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64go22 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gomp1 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gphobos-13-dev deb libdevel optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64gphobos4 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64itm1 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64objc-13-dev deb libdevel optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64objc4 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64quadmath0 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64stdc++-13-dev deb libdevel optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64stdc++6 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64stdc++6-13-dbg deb debug optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 lib64ubsan1 deb libs optional arch=i386,powerpc,sparc,s390,mips,mipsel,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,x32
 libasan8 deb libs optional arch=any
 libatomic1 deb libs optional arch=any
 libcc1-0 deb libs optional arch=any
 libgcc-13-dev deb libdevel optional arch=any
 libgcc-s1 deb libs optional arch=any protected=yes
 libgcc-s2 deb libs optional arch=m68k protected=yes
 libgcc-s4 deb libs optional arch=hppa protected=yes
 libgccjit-13-dev deb libdevel optional arch=any
 libgccjit-13-doc deb doc optional arch=all
 libgccjit0 deb libs optional arch=any
 libgfortran-13-dev deb libdevel optional arch=any
 libgfortran5 deb libs optional arch=any
 libgm2-13-dev deb libdevel optional arch=any
 libgm2-18 deb libs optional arch=any
 libgnat-13 deb libs optional arch=any
 libgo-13-dev deb libdevel optional arch=any
 libgo22 deb libs optional arch=any
 libgomp-plugin-amdgcn1 deb libs optional arch=amd64
 libgomp-plugin-nvptx1 deb libs optional arch=amd64,ppc64el
 libgomp1 deb libs optional arch=any
 libgphobos-13-dev deb libdevel optional arch=amd64,arm64,armel,armhf,i386,x32,hppa,mips,mips64,mipsel,mips64el,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el,riscv64,s390x,powerpc,ppc64,ppc64el
 libgphobos4 deb libs optional arch=amd64,arm64,armel,armhf,i386,x32,hppa,mips,mips64,mipsel,mips64el,mipsn32,mipsn32el,mipsr6,mipsr6el,mipsn32r6,mipsn32r6el,mips64r6,mips64r6el,riscv64,s390x,powerpc,ppc64,ppc64el
 libhwasan0 deb libs optional arch=any
 libitm1 deb libs optional arch=any
 liblsan0 deb libs optional arch=any
 libn32atomic1 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gcc-13-dev deb libdevel optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gcc-s1 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gfortran-13-dev deb libdevel optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gfortran5 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32go-13-dev deb libdevel optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32go22 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gomp1 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gphobos-13-dev deb libdevel optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32gphobos4 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32objc-13-dev deb libdevel optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32objc4 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32stdc++-13-dev deb libdevel optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32stdc++6 deb libs optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libn32stdc++6-13-dbg deb debug optional arch=mips,mipsel,mips64,mips64el,mipsr6,mipsr6el,mips64r6,mips64r6el
 libobjc-13-dev deb libdevel optional arch=any
 libobjc4 deb libs optional arch=any
 libquadmath0 deb libs optional arch=any
 libstdc++-13-dev deb libdevel optional arch=any
 libstdc++-13-doc deb doc optional arch=all
 libstdc++-13-pic deb libdevel optional arch=any
 libstdc++6 deb libs optional arch=any
 libstdc++6-13-dbg deb debug optional arch=any
 libtsan2 deb libs optional arch=any
 libubsan1 deb libs optional arch=any
 libx32asan8 deb libs optional arch=amd64,i386
 libx32atomic1 deb libs optional arch=amd64,i386
 libx32gcc-13-dev deb libdevel optional arch=amd64,i386
 libx32gcc-s1 deb libs optional arch=amd64,i386
 libx32gfortran-13-dev deb libdevel optional arch=amd64,i386
 libx32gfortran5 deb libs optional arch=amd64,i386
 libx32go-13-dev deb libdevel optional arch=amd64,i386
 libx32go22 deb libs optional arch=amd64,i386
 libx32gomp1 deb libs optional arch=amd64,i386
 libx32gphobos-13-dev deb libdevel optional arch=amd64,i386
 libx32gphobos4 deb libs optional arch=amd64,i386
 libx32itm1 deb libs optional arch=amd64,i386
 libx32objc-13-dev deb libdevel optional arch=amd64,i386
 libx32objc4 deb libs optional arch=amd64,i386
 libx32quadmath0 deb libs optional arch=amd64,i386
 libx32stdc++-13-dev deb libdevel optional arch=amd64,i386
 libx32stdc++6 deb libs optional arch=amd64,i386
 libx32stdc++6-13-dbg deb debug optional arch=amd64,i386
 libx32ubsan1 deb libs optional arch=amd64,i386
Checksums-Sha1:
 ab05997fc48797ca32671b3c3dfd460a3fb40c1f 92596024 gcc-13_13.2.0.orig.tar.gz
 991a9ad8cdf578a7d139708fef9bb2a1f953b090 1654360 gcc-13_13.2.0-6ubuntu1.debian.tar.xz
Checksums-Sha256:
 84d4bbded73e549b2af0411691cbd7bea6a86e15796881a92518fb741cdaad2f 92596024 gcc-13_13.2.0.orig.tar.gz
 03d3cd0699bf75c3629af27e17b0799b933a9031e14863a08e7f31a5897634bf 1654360 gcc-13_13.2.0-6ubuntu1.debian.tar.xz
Files:
 cba12972f6b3431e9359a2afd2193fc1 92596024 gcc-13_13.2.0.orig.tar.gz
 fc990f91eb369e5f9c9a4e35342757fc 1654360 gcc-13_13.2.0-6ubuntu1.debian.tar.xz
Original-Maintainer: Debian GCC Maintainers <debian-gcc@lists.debian.org>

-----BEGIN PGP SIGNATURE-----

iQJEBAEBCgAuFiEE1WVxuIqLuvFAv2PWvX6qYHePpvUFAmU5H/kQHGRva29AdWJ1
bnR1LmNvbQAKCRC9fqpgd4+m9dhND/4xFdEbyyzD91f6ox1tJqejskW0qjWBzAff
aPycipwFhrkQxMV6gwJR1FwIqJ7ADSDWD3GJCfizPQzJkG1KdUo6iASyWnTaJGgS
RZ3iGiC2SLpwPv3yST9BSCJJPQ+aDdTjo8X7xyP1XPpm3lKtZIYm5iA0yYduldpc
uq30RGR6/jLM6R/okWlZMHUofP2VV1HBjVb/JI1mFKQ7X60AnwB+UF/io9fpSmOg
qvPdegpTJTYfh5PdLBRjKcat26EsWu4ITX82nNXt0gu7oZmvGde5rypQ96yrpJ37
DC1T8SBTvGun3seY1AMELuxoLUpuNg8/WqvI9haCX9CJnPf0oPgottaSXdApW9pG
XKDyqTyfPLtA+VCyJK93XeOwFP8YwMbEgfPiJXUIIJMtaHTHcF6zPpB2rQ9TlP4S
DoA1yKcYH+CL5tqAnQTc0b59Pmj+UyyziCuyYnHMyqsuLLyOZ/nR+ItDLJBBZyRg
0Xj3q554zR+MwiqCIp9rMVQ/LvcHgq9vu+RNwaRl2TEby4sDwgewhHK3TxeesmY8
cTasq5wpoAIQZARkMzW6fiylpGoFyOr45kPm6bohNo8h8/DqDbIT57+oGEsmxrMn
bUwdE5SeuUrLFdRHUDQ/ZhG7KfBxg0YUPkDdN10NPLLLoueSPnPWLNaOZN9m5Yun
2P4gHfsaLg==
=b8g9
-----END PGP SIGNATURE-----
