"""Loopback service boundaries shared by browser and Electron launch modes."""
from urllib.parse import urlsplit
from starlette.requests import Request

SECURITY_HEADERS = {
    'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
}


def local_request_error(request: Request, default_port: int, desktop: bool) -> str | None:
    server = request.scope.get('server')
    port = server[1] if server else default_port
    hosts = {f'127.0.0.1:{port}'}
    if not desktop:
        hosts.add(f'localhost:{port}')
        if port == 80: hosts.update({'127.0.0.1', 'localhost'})
    host = request.headers.get('host', '').lower()
    if host not in hosts:
        return '本地服务主机校验失败'

    if request.method in {'GET', 'HEAD', 'OPTIONS'}:
        return None
    expected = urlsplit(f'http://{host}')

    def same_origin(value: str, referrer: bool = False) -> bool:
        try:
            source = urlsplit(value)
            return (source.scheme == 'http' and source.hostname == expected.hostname
                    and (source.port or 80) == (expected.port or 80)
                    and source.username is None and source.password is None
                    and (referrer or not source.path and not source.query and not source.fragment))
        except ValueError:
            return False

    origin = request.headers.get('origin')
    referrer = request.headers.get('referer')
    if origin is not None and not same_origin(origin):
        return '拒绝非本地应用来源的写入请求'
    if origin is None and referrer is not None and not same_origin(referrer, referrer=True):
        return '拒绝非本地应用来源的写入请求'
    if request.headers.get('sec-fetch-site', '').lower() not in {'', 'same-origin', 'none'}:
        return '拒绝跨站写入请求'
    # Non-browser local clients omit browser origin metadata; desktop clients
    # additionally require the random session cookie/token in the middleware.
    return None
