"""Manual, bounded public release check. No scheduler, secrets or media paths."""
import json
import re
from urllib.request import Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError,URLError
from fastapi import HTTPException

REPOSITORY='https://github.com/jhlxlml/avhub'
ENDPOINT='https://api.github.com/repos/jhlxlml/avhub/releases/latest'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,url):
        raise HTTPError(request.full_url,code,'Unexpected redirect',headers,fp)
def fetch_release(request):return build_opener(NoRedirect).open(request,timeout=10)
def version(value):
    if not isinstance(value,str) or len(value)>50 or not re.fullmatch(r'v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)',value):raise ValueError('正式版本号无效')
    return tuple(int(part) for part in value.lstrip('v').split('.'))
def release_info(value,current):
    if not isinstance(value,dict) or value.get('draft') is not False or value.get('prerelease') is not False:raise ValueError('不是正式发布')
    tag=value.get('tag_name');remote=version(tag);local=version(current)
    number='.'.join(map(str,remote));filename=f'AVHub-portable-{number}-x64.exe'
    asset_url=f'{REPOSITORY}/releases/download/{tag}/{filename}'
    assets=value.get('assets',[])
    if not isinstance(assets,list):raise ValueError('下载文件信息无效')
    ready=any(isinstance(a,dict) and a.get('name')==filename and a.get('state')=='uploaded' and type(a.get('size')) is int and a['size']>0 and a.get('browser_download_url')==asset_url for a in assets)
    status='available' if remote>local and ready else 'pending' if remote>local else 'current' if remote==local else 'ahead'
    return {'status':status,'version':number,'tag':tag,'published_at':str(value.get('published_at') or '')[:50],'notes':str(value.get('body') or '')[:5000],'download_ready':ready}
def check(current):
    request=Request(ENDPOINT,headers={'Accept':'application/vnd.github+json','User-Agent':'AVHub-manual-update-check','X-GitHub-Api-Version':'2026-03-10'})
    try:
        with fetch_release(request) as response:
            if response.geturl()!=ENDPOINT:raise ValueError('更新服务发生未预期的跳转')
            data=response.read(512*1024+1)
            if len(data)>512*1024:raise ValueError('更新响应超过大小限制')
        return release_info(json.loads(data),current)
    except HTTPError as error:
        if error.code==404:return {'status':'unpublished'}
        if error.code in (403,429):raise HTTPException(503,'GitHub 更新检查暂时受限，请稍后手动重试') from None
        raise HTTPException(502,'无法获取正式发布信息，请稍后手动重试') from None
    except (TimeoutError,URLError,OSError):raise HTTPException(504,'检查更新超时或网络不可用，不影响离线播放') from None
    except (ValueError,TypeError,OverflowError):raise HTTPException(502,'更新信息无效，请稍后手动重试') from None
