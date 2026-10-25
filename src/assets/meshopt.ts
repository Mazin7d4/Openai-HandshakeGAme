import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression.js';

// GLBs are meshopt-compressed (EXT_meshopt_compression, ~60% smaller). Serve the decoder
// from our own origin instead of Babylon's CDN so offline/LAN play keeps working.
MeshoptCompression.Configuration = {
  decoder: { url: `${import.meta.env.BASE_URL}vendor/meshopt_decoder.js` },
};
