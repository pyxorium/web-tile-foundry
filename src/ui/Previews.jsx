// The two looks a tile has on webtil.es: a static card in the feed, and the
// live tile once someone clicks it.

export function LiveTile({ html, title, className = "" }) {
  // sandbox="allow-scripts" without allow-same-origin: the tile runs in an
  // opaque origin with no storage and no access to this page, much like the
  // real tile loader's sandbox. Its own security policy blocks the network.
  return (
    <iframe
      className={`live-tile ${className}`}
      title={`Live preview: ${title}`}
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}

// A frame's page can't fetch the tile's other files, so scripts the page loads
// from the tile (like Glass Lantern's /lantern.js) are put inside it for the preview.
function frameHtml(result) {
  return result.html.replace(/<script src="(\/[^"]+\.js)"><\/script>/g, (whole, path) => {
    const file = result.files.find((f) => f.path === path);
    if (!file) return whole;
    const code = new TextDecoder().decode(file.bytes).replace(/<\/script/gi, "<\\/script");
    return `<script>${code}</script>`;
  });
}

export function CardPreview({ result, urls, live, onToggleLive }) {
  const icon = result.icons[0] && urls[result.icons[0].src];
  const banner = result.screenshots[0] && urls[result.screenshots[0].src];
  return (
    <div className="card-frame">
      {live ? (
        <LiveTile html={frameHtml(result)} title={result.name} className="card-live" />
      ) : (
        <button type="button" className="tile-card" onClick={onToggleLive} aria-label="Open the live tile">
          {banner && <img className="tile-card-banner" src={banner} alt="" />}
          <span className="tile-card-body">
            {icon && <img className="tile-card-icon" src={icon} alt="" width="44" height="44" />}
            <span>
              <span className="tile-card-name">{result.name}</span>
              {result.description && <span className="tile-card-desc">{result.description}</span>}
            </span>
          </span>
        </button>
      )}
      <button type="button" className="btn btn-quiet card-toggle" onClick={onToggleLive}>
        {live ? "Back to the card" : "Open the live tile"}
      </button>
    </div>
  );
}
