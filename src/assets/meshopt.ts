import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression.js';
import { Tools } from '@babylonjs/core/Misc/tools.js';

// GLBs are meshopt-compressed (EXT_meshopt_compression, ~60% smaller). Serve the decoder
// from our own origin instead of Babylon's CDN so offline/LAN play keeps working.
// Keep Babylon's other lazily loaded helper scripts on that same origin as well.
Tools.ScriptBaseUrl = `${import.meta.env.BASE_URL}vendor/`;
MeshoptCompression.Configuration = {
  decoder: { url: `${import.meta.env.BASE_URL}vendor/meshopt_decoder.js` },
};
