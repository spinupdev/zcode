# zcode-runtime-python

Run **Python in the browser** with [Pyodide](https://pyodide.org/) — no remote server (WB1).

- Registers backend id `browser-python` with `zcode-runtime-core`
- First run downloads WASM from `zcode.execution.pyodideIndexUrl` (jsDelivr by default)
- Use **ZCode: Run File** on a `.py` editor

Limits: no arbitrary native wheels; scientific stack partial via micropip (future).
