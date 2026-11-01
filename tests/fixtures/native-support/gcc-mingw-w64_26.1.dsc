-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

Format: 3.0 (native)
Source: gcc-mingw-w64
Binary: gcc-mingw-w64, gcc-mingw-w64-i686, gcc-mingw-w64-i686-posix, gcc-mingw-w64-i686-win32, gcc-mingw-w64-x86-64, gcc-mingw-w64-x86-64-posix, gcc-mingw-w64-x86-64-win32, g++-mingw-w64, g++-mingw-w64-i686, g++-mingw-w64-i686-posix, g++-mingw-w64-i686-win32, g++-mingw-w64-x86-64, g++-mingw-w64-x86-64-posix, g++-mingw-w64-x86-64-win32, gfortran-mingw-w64, gfortran-mingw-w64-i686, gfortran-mingw-w64-i686-posix, gfortran-mingw-w64-i686-win32, gfortran-mingw-w64-x86-64, gfortran-mingw-w64-x86-64-posix, gfortran-mingw-w64-x86-64-win32, gobjc-mingw-w64, gobjc-mingw-w64-i686, gobjc-mingw-w64-i686-posix, gobjc-mingw-w64-i686-win32, gobjc-mingw-w64-x86-64, gobjc-mingw-w64-x86-64-posix, gobjc-mingw-w64-x86-64-win32, gobjc++-mingw-w64, gobjc++-mingw-w64-i686, gobjc++-mingw-w64-i686-posix, gobjc++-mingw-w64-i686-win32, gobjc++-mingw-w64-x86-64, gobjc++-mingw-w64-x86-64-posix, gobjc++-mingw-w64-x86-64-win32, gnat-mingw-w64, gnat-mingw-w64-i686, gnat-mingw-w64-i686-posix,
 gnat-mingw-w64-i686-win32, gnat-mingw-w64-x86-64, gnat-mingw-w64-x86-64-posix, gnat-mingw-w64-x86-64-win32, gcc-mingw-w64-i686-posix-runtime, gcc-mingw-w64-i686-win32-runtime, gcc-mingw-w64-x86-64-posix-runtime, gcc-mingw-w64-x86-64-win32-runtime,
 gcc-mingw-w64-base
Architecture: any all
Version: 26.1
Maintainer: Stephen Kitt <skitt@debian.org>
Homepage: https://www.gnu.org/software/gcc/
Standards-Version: 4.6.2
Vcs-Browser: https://salsa.debian.org/mingw-w64-team/gcc-mingw-w64
Vcs-Git: https://salsa.debian.org/mingw-w64-team/gcc-mingw-w64.git
Build-Depends: autotools-dev, binutils-mingw-w64-i686 (>= 2.30~), binutils-mingw-w64-x86-64 (>= 2.30~), bison, debhelper, flex, g++-13 <!stage1>, gcc-13-source, gnat-13 [alpha amd64 arm64 armel armhf hppa i386 mips64el mipsel ppc64 ppc64el riscv64 s390x sh4 sparc64 x32] <!stage1>, libelf-dev, libgmp-dev, libisl-dev, libmpc-dev, libmpfr-dev, mingw-w64-i686-dev <!stage1>, mingw-w64-x86-64-dev <!stage1>, xz-utils, zlib1g-dev
Package-List:
 g++-mingw-w64 deb devel optional arch=all profile=!stage1
 g++-mingw-w64-i686 deb devel optional arch=all profile=!stage1
 g++-mingw-w64-i686-posix deb devel optional arch=any profile=!stage1
 g++-mingw-w64-i686-win32 deb devel optional arch=any profile=!stage1
 g++-mingw-w64-x86-64 deb devel optional arch=all profile=!stage1
 g++-mingw-w64-x86-64-posix deb devel optional arch=any profile=!stage1
 g++-mingw-w64-x86-64-win32 deb devel optional arch=any profile=!stage1
 gcc-mingw-w64 deb devel optional arch=all profile=!stage1
 gcc-mingw-w64-base deb devel optional arch=any
 gcc-mingw-w64-i686 deb devel optional arch=all profile=!stage1
 gcc-mingw-w64-i686-posix deb devel optional arch=any profile=!stage1
 gcc-mingw-w64-i686-posix-runtime deb devel optional arch=any
 gcc-mingw-w64-i686-win32 deb devel optional arch=any profile=!stage1
 gcc-mingw-w64-i686-win32-runtime deb devel optional arch=any
 gcc-mingw-w64-x86-64 deb devel optional arch=all profile=!stage1
 gcc-mingw-w64-x86-64-posix deb devel optional arch=any profile=!stage1
 gcc-mingw-w64-x86-64-posix-runtime deb devel optional arch=any
 gcc-mingw-w64-x86-64-win32 deb devel optional arch=any profile=!stage1
 gcc-mingw-w64-x86-64-win32-runtime deb devel optional arch=any
 gfortran-mingw-w64 deb devel optional arch=all profile=!stage1
 gfortran-mingw-w64-i686 deb devel optional arch=all profile=!stage1
 gfortran-mingw-w64-i686-posix deb devel optional arch=any profile=!stage1
 gfortran-mingw-w64-i686-win32 deb devel optional arch=any profile=!stage1
 gfortran-mingw-w64-x86-64 deb devel optional arch=all profile=!stage1
 gfortran-mingw-w64-x86-64-posix deb devel optional arch=any profile=!stage1
 gfortran-mingw-w64-x86-64-win32 deb devel optional arch=any profile=!stage1
 gnat-mingw-w64 deb devel optional arch=all profile=!stage1
 gnat-mingw-w64-i686 deb devel optional arch=all profile=!stage1
 gnat-mingw-w64-i686-posix deb devel optional arch=alpha,amd64,arm64,armel,armhf,hppa,i386,mips64el,mipsel,ppc64,ppc64el,riscv64,s390x,sh4,sparc64,x32 profile=!stage1
 gnat-mingw-w64-i686-win32 deb devel optional arch=alpha,amd64,arm64,armel,armhf,hppa,i386,mips64el,mipsel,ppc64,ppc64el,riscv64,s390x,sh4,sparc64,x32 profile=!stage1
 gnat-mingw-w64-x86-64 deb devel optional arch=all profile=!stage1
 gnat-mingw-w64-x86-64-posix deb devel optional arch=alpha,amd64,arm64,armel,armhf,hppa,i386,mips64el,mipsel,ppc64,ppc64el,riscv64,s390x,sh4,sparc64,x32 profile=!stage1
 gnat-mingw-w64-x86-64-win32 deb devel optional arch=alpha,amd64,arm64,armel,armhf,hppa,i386,mips64el,mipsel,ppc64,ppc64el,riscv64,s390x,sh4,sparc64,x32 profile=!stage1
 gobjc++-mingw-w64 deb devel optional arch=all profile=!stage1
 gobjc++-mingw-w64-i686 deb devel optional arch=all profile=!stage1
 gobjc++-mingw-w64-i686-posix deb devel optional arch=any profile=!stage1
 gobjc++-mingw-w64-i686-win32 deb devel optional arch=any profile=!stage1
 gobjc++-mingw-w64-x86-64 deb devel optional arch=all profile=!stage1
 gobjc++-mingw-w64-x86-64-posix deb devel optional arch=any profile=!stage1
 gobjc++-mingw-w64-x86-64-win32 deb devel optional arch=any profile=!stage1
 gobjc-mingw-w64 deb devel optional arch=all profile=!stage1
 gobjc-mingw-w64-i686 deb devel optional arch=all profile=!stage1
 gobjc-mingw-w64-i686-posix deb devel optional arch=any profile=!stage1
 gobjc-mingw-w64-i686-win32 deb devel optional arch=any profile=!stage1
 gobjc-mingw-w64-x86-64 deb devel optional arch=all profile=!stage1
 gobjc-mingw-w64-x86-64-posix deb devel optional arch=any profile=!stage1
 gobjc-mingw-w64-x86-64-win32 deb devel optional arch=any profile=!stage1
Checksums-Sha1:
 e7bcb6e15e32f20ba2ccc2f670bee4be3c27461e 34428 gcc-mingw-w64_26.1.tar.xz
Checksums-Sha256:
 57ad0cef766683b97b37de82a16a5b69f81a28c1469512832f557bca2506c8ef 34428 gcc-mingw-w64_26.1.tar.xz
Files:
 53a7059834612a447999a4c45ae252b1 34428 gcc-mingw-w64_26.1.tar.xz

-----BEGIN PGP SIGNATURE-----

iQIzBAEBCgAdFiEEnPVX/hPLkMoq7x0ggNMC9Yhtg5wFAmUQgkQACgkQgNMC9Yht
g5we7g//VAcImMjBgOD9rrnCOCgpnb6G3mniie2GKaqJc3GdRBAc9d7naIlATgJs
dp28akDJzEp1nEi/V4AOqvrl0fApuo9X+umGc0k8ebW2se5JNKlogrkLvKisihUK
qmU6fQBWnJzM5Gbi6MU5uSc2PeqGPeibr4pssDccPpvcdUF1+akvzFc2884eIUvt
y/KP0Ukyn/dF81MzKPBRAKLBUzvIvomETqYA94r3whUdlawr9k4pH9s/iA8/4Dh3
E0jT7MGUE8aRY4yr/87FHFkDMZ5wRphlIyKTBJoEh3FG9aalBw1P2B+4QKFEDAqe
3YN7rn2gfDbeab0wupWkKqydSbhOGtwGfG935eypp8Ru2Y+k7akq6OEY7oixQlne
YdGjh0cF1pKrUqXC8gdkfPYuxLHyweEvu0NJ0wuEVkX1dFUfNbTkVx6X6XnRr7bB
tUntQrElef1SbVZt6lxcbX0A7EuiKbEmjjrFsHFY0iWmG7YDcC0sZoW43Oa8yjVO
HNq5KU28adZ6SF/Fdm7dcUfBv2t/E7TrJxDWii5h2v1YYaaprDaBzES4nmCcJk3M
Yxa3jsicG58xtZTIpYcwf8LbVlM6NcnlTZkfBCF+0WJk7ZriMCvzMk1QGmgoFVtL
h5/Bu0mZ0vIWCxS5EztGnAYg+pMeA+nSpJfdKkYsJK8aYuqHozo=
=QDq8
-----END PGP SIGNATURE-----
