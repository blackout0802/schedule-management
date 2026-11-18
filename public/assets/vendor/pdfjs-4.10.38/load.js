// PDF.js（Mozilla。Apache License 2.0。LICENSE.txt）を読み込む入口。年間計画の「PDFから取り込む」を開いたときだけ読む（app.js の loadPdfjs）。
// PDF.js 本体は、ES のモジュールなので、ここも <script type="module"> で読む。拡張子は、サーバーが JavaScript として返すよう .js にしてある（元は .mjs）
import * as pdfjsLib from './pdf.min.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', import.meta.url).href;
window.SchedPdfjs = pdfjsLib;
