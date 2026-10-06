lamejs 1.2.1: MP3 encoding for the Foundry's audio tile types.

A JavaScript port of LAME (https://lame.sourceforge.io/), from
https://github.com/zhuker/lamejs (commit 582bbba6a12f981b984d8fb9e1874499fed85675), file lame.min.js.

Used UNMODIFIED, as a separate file, under the GNU Lesser General Public
License 3.0 (https://www.gnu.org/licenses/lgpl-3.0.html). See LICENSE for the
LAME project's notes on using LAME in other programs. You may replace this
file with another build of lamejs that offers the same Mp3Encoder interface.

It runs only inside the Foundry (in public/audio/encode-worker.js) and is
never included in published tiles.
