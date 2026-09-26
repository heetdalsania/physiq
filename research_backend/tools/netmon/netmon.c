/* netmon — macOS network-call monitor for the research worker smoke test.
 *
 * Injected with DYLD_INSERT_LIBRARIES, it interposes the libc networking
 * entry points and appends one line per call to the file named by
 * $NETMON_LOG. Because it interposes at the C library, it sees calls made by
 * native code (e.g. libmediapipe) as well as by Python. It changes nothing:
 * every call is forwarded unchanged.
 *
 *   clang -dynamiclib -O2 -o netmon.dylib netmon.c
 *   NETMON_LOG=/tmp/net.log DYLD_INSERT_LIBRARIES=$PWD/netmon.dylib python …
 *
 * Limitations (documented in MILESTONE_7_VERIFICATION.md): it cannot see
 * traffic made through Apple's Network.framework without BSD sockets, so the
 * smoke test additionally samples `lsof -i` for the process. Only
 * non-SIP-protected executables (e.g. Homebrew Python) can be injected.
 */
#include <arpa/inet.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define DYLD_INTERPOSE(_replacement, _replacee) \
  __attribute__((used)) static struct { const void *replacement; const void *replacee; } _interpose_##_replacee \
  __attribute__((section("__DATA,__interpose"))) = { (const void *)(unsigned long)&_replacement, (const void *)(unsigned long)&_replacee };

static void logline(const char *fmt, ...) {
  const char *path = getenv("NETMON_LOG");
  if (!path) return;
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n <= 0) return;
  if (n >= (int)sizeof buf) n = sizeof buf - 1;
  int fd = open(path, O_WRONLY | O_APPEND | O_CREAT, 0600);
  if (fd < 0) return;
  (void)write(fd, buf, (size_t)n);
  close(fd);
}

static void describe(const struct sockaddr *sa, char *out, size_t len) {
  if (!sa) { snprintf(out, len, "null"); return; }
  if (sa->sa_family == AF_INET) {
    const struct sockaddr_in *in = (const struct sockaddr_in *)sa;
    char ip[INET_ADDRSTRLEN] = "?";
    inet_ntop(AF_INET, &in->sin_addr, ip, sizeof ip);
    snprintf(out, len, "inet %s:%u", ip, ntohs(in->sin_port));
  } else if (sa->sa_family == AF_INET6) {
    const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)sa;
    char ip[INET6_ADDRSTRLEN] = "?";
    inet_ntop(AF_INET6, &in6->sin6_addr, ip, sizeof ip);
    snprintf(out, len, "inet6 [%s]:%u", ip, ntohs(in6->sin6_port));
  } else if (sa->sa_family == AF_UNIX) {
    const struct sockaddr_un *un = (const struct sockaddr_un *)sa;
    snprintf(out, len, "unix %.100s", un->sun_path);
  } else {
    snprintf(out, len, "family=%d", sa->sa_family);
  }
}

static int nm_socket(int domain, int type, int protocol) {
  int fd = socket(domain, type, protocol);
  logline("pid=%d socket domain=%d type=%d protocol=%d fd=%d\n", getpid(), domain, type, protocol, fd);
  return fd;
}
DYLD_INTERPOSE(nm_socket, socket)

static int nm_connect(int s, const struct sockaddr *addr, socklen_t len) {
  char d[128];
  describe(addr, d, sizeof d);
  logline("pid=%d connect fd=%d %s\n", getpid(), s, d);
  return connect(s, addr, len);
}
DYLD_INTERPOSE(nm_connect, connect)

static int nm_connectx(int s, const sa_endpoints_t *ep, sae_associd_t aid, unsigned int flags, const struct iovec *iov,
                       unsigned int iovcnt, size_t *len, sae_connid_t *cid) {
  char d[128];
  describe(ep ? ep->sae_dstaddr : NULL, d, sizeof d);
  logline("pid=%d connectx fd=%d %s\n", getpid(), s, d);
  return connectx(s, ep, aid, flags, iov, iovcnt, len, cid);
}
DYLD_INTERPOSE(nm_connectx, connectx)

static ssize_t nm_sendto(int s, const void *buf, size_t n, int flags, const struct sockaddr *to, socklen_t tolen) {
  if (to) {
    char d[128];
    describe(to, d, sizeof d);
    logline("pid=%d sendto fd=%d %s bytes=%zu\n", getpid(), s, d, n);
  }
  return sendto(s, buf, n, flags, to, tolen);
}
DYLD_INTERPOSE(nm_sendto, sendto)

static int nm_getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
  logline("pid=%d getaddrinfo node=%s service=%s\n", getpid(), node ? node : "(null)", service ? service : "(null)");
  return getaddrinfo(node, service, hints, res);
}
DYLD_INTERPOSE(nm_getaddrinfo, getaddrinfo)

static struct hostent *nm_gethostbyname(const char *name) {
  logline("pid=%d gethostbyname name=%s\n", getpid(), name ? name : "(null)");
  return gethostbyname(name);
}
DYLD_INTERPOSE(nm_gethostbyname, gethostbyname)

__attribute__((constructor)) static void nm_loaded(void) { logline("pid=%d netmon loaded\n", getpid()); }
