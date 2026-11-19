import base64, hashlib, json, os, re, resource, subprocess, sys
from pathlib import Path

def main():
    raw = sys.stdin.buffer.read(34 * 1024 * 1024 + 1)
    if len(raw) > 34 * 1024 * 1024:
        raise ValueError('编译输入过大。')
    job = json.loads(raw)
    source = job['source']
    if not isinstance(source, str) or len(source.encode()) > 1000000 or len(job['assets']) > 32:
        raise ValueError('编译输入格式不正确。')
    total = 0
    for asset in job['assets']:
        name = asset['name']
        if not re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|pdf)', name):
            raise ValueError('附件名称不正确。')
        data = base64.b64decode(asset['data'], validate=True)
        total += len(data)
        if total > 24 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != name[:64]:
            raise ValueError('附件校验失败。')
        Path(name).write_bytes(data)
    Path('page.tex').write_text(source, encoding='utf8')
    env = dict(PATH='/usr/bin:/bin', HOME='/work', TMPDIR='/work', TEXMFHOME='/work/empty', TEXMFOUTPUT='/work', openin_any='p', openout_any='p', shell_escape='f', MKTEXPK='0', MKTEXTFM='0', SOURCE_DATE_EPOCH='1775001600', FORCE_SOURCE_DATE='1')
    # Only a fixed allowlist of engines; the source cannot supply a command.
    engine = 'xelatex' if re.search(r'^% FudanEngine: xelatex\s*$', source, re.M) else 'pdflatex'
    cmd = [engine, '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-recorder', '-jobname=page', 'page.tex']
    for _ in range(2):
        with open('console.log', 'wb') as log:
            result = subprocess.run(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=12)
        if result.returncode:
            lines = Path('console.log').read_text(errors='replace').splitlines()
            start = next((i for i, line in enumerate(lines) if re.match(r'^!|^\./page\.tex:\d+:|LaTeX Error|Emergency stop|not allowed', line)), max(0, len(lines)-18))
            raise ValueError('LaTeX 编译失败：\n' + '\n'.join(lines[start:start+16])[:2600])
    pdf = Path('page.pdf')
    if not pdf.is_file() or pdf.is_symlink() or pdf.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('未生成有效PDF，或输出超过20 MB。')
    data = pdf.read_bytes()
    if not data.startswith(b'%PDF-'):
        raise ValueError('PDF格式不正确。')
    return dict(ok=True, pdf=base64.b64encode(data).decode())

try:
    # The container also has a hard file-size limit and a 64 MiB tmpfs.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    result = main()
except subprocess.TimeoutExpired:
    result = dict(ok=False, error='LaTeX编译超过时限，请拆分页面或简化图形。')
except Exception as e:
    result = dict(ok=False, error=str(e)[:2800])
sys.stdout.write(json.dumps(result, ensure_ascii=True))
