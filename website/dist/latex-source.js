import {legacyDocument,legacyMarker} from './legacy-format.js';
export const commonPackages=['amsmath','amssymb','amsthm','mathtools','bm','mathrsfs','dsfont','siunitx','tikz','tikz-cd','pgfplots','graphicx','hyperref','xcolor','geometry','enumitem'];
const prelude=String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage{CJKutf8}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm,mathtools,bm,mathrsfs,dsfont}
\usepackage{siunitx,tikz,tikz-cd,pgfplots,graphicx,xcolor,enumitem}
\usepackage[margin=18mm,paperwidth=180mm,paperheight=260mm]{geometry}
\usepackage[unicode,colorlinks=true,linkcolor=blue,urlcolor=blue]{hyperref}
\pgfplotsset{compat=1.18}
\usetikzlibrary{arrows.meta,calc,positioning,decorations.pathmorphing,patterns,matrix,cd,fit,shapes.geometric}
\newtheorem{theorem}{定理}[section]
\newtheorem{lemma}[theorem]{引理}
\newtheorem{proposition}[theorem]{命题}
\newtheorem{corollary}[theorem]{推论}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{定义}
\newtheorem{example}[theorem]{例}
\newtheorem{remark}[theorem]{注}
\renewcommand{\proofname}{证明}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.6em}
\pagestyle{empty}
`;
export function buildDocument(tex,preamble=''){
 if(/^\s*\\documentclass\b/m.test(tex))return tex; // A complete source can provide its own preamble.
 if(preamble.includes(legacyMarker))return legacyDocument(tex,preamble);
 return prelude+'\n'+preamble+'\n\\begin{document}\n\\begin{CJK*}{UTF8}{gbsn}\n'+tex+'\n\\end{CJK*}\n\\end{document}\n';
}
