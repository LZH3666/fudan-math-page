ARG DEBIAN_BASE
FROM ${DEBIAN_BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends python3 texlive-latex-extra texlive-science texlive-lang-chinese texlive-fonts-recommended texlive-fonts-extra latex-cjk-chinese latex-cjk-chinese-arphic-gbsn00lp && rm -rf /var/lib/apt/lists/* \
 && dpkg-query -W > /opt/tex-packages.txt
RUN apt-get update && apt-get install -y --no-install-recommends cm-super \
 && rm -rf /var/lib/apt/lists/* && dpkg-query -W > /opt/tex-packages.txt
COPY smoke.tex /opt/smoke.tex
RUN cd /tmp && kpsewhich CJKutf8.sty && MKTEXPK=0 MKTEXTFM=0 pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error /opt/smoke.tex && test -s smoke.pdf && rm -f smoke.*
RUN apt-get update && apt-get install -y --no-install-recommends texlive-xetex fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* && dpkg-query -W > /opt/tex-packages.txt
COPY smoke-xe.tex /opt/smoke-xe.tex
RUN apt-get update && apt-get install -y --no-install-recommends fonts-texgyre && rm -rf /var/lib/apt/lists/* && dpkg-query -W > /opt/tex-packages.txt
RUN cd /tmp && xelatex -no-shell-escape -interaction=nonstopmode -halt-on-error /opt/smoke-xe.tex && test -s smoke-xe.pdf && rm -f smoke-xe.*
COPY runner.py /opt/runner.py
RUN apt-get update && apt-get install -y --no-install-recommends texlive-plain-generic && rm -rf /var/lib/apt/lists/* && dpkg-query -W > /opt/tex-packages.txt
COPY smoke-import.tex /opt/smoke-import.tex
RUN cd /tmp && xelatex -no-shell-escape -interaction=nonstopmode -halt-on-error /opt/smoke-import.tex && test -s smoke-import.pdf && rm -f smoke-import.*
RUN chmod 555 /opt/runner.py && mkdir /work && chown 10001:10001 /work
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python3", "-I", "/opt/runner.py"]
