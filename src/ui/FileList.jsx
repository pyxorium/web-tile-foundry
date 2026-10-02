import { formatSize } from "../core/fileset.js";

// What would be written to the user's account: every file, its type, size and
// address. In maker-lite the files can be downloaded; publishing comes next.

const LABELS = {
  "/": "The tile itself",
  "/icon.png": "Card icon",
  "/banner.png": "Card banner",
  "/foundry.json": "Recipe",
};

function downloadName(path) {
  return path === "/" ? "index.html" : path.slice(1);
}

export function FileList({ result, urls }) {
  return (
    <div className="files">
      <table>
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Type</th>
            <th scope="col" className="num">Size</th>
            <th scope="col">Address</th>
            <th scope="col"><span className="sr-only">Download</span></th>
          </tr>
        </thead>
        <tbody>
          {result.files.map((f) => (
            <tr key={f.path}>
              <td>
                <span className="mono">{f.path}</span>
                <span className="file-label">{LABELS[f.path] || ""}</span>
              </td>
              <td className="mono">{f.contentType}</td>
              <td className="num">{formatSize(f.bytes.length)}</td>
              <td className="mono addr" title={f.cid}>{f.cid.slice(0, 12)}…{f.cid.slice(-6)}</td>
              <td>
                {urls[f.path] && (
                  <a className="btn btn-small" href={urls[f.path]} download={downloadName(f.path)}>
                    Download
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="2">Total</td>
            <td className="num">{formatSize(result.totalBytes)}</td>
            <td colSpan="2" />
          </tr>
        </tfoot>
      </table>
      <details className="recipe">
        <summary>Show the recipe (/foundry.json)</summary>
        <pre>{new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes)}</pre>
      </details>
    </div>
  );
}
