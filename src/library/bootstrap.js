// The declarative runtime can finish downloading before a module graph, which
// would let it evaluate the component shim before the module-backed factory is
// available. Load the runtime only after app.js has installed that bridge.
import './app.js';

const runtime = document.createElement('script');
runtime.src = new URL('../../support.js', import.meta.url).href;
runtime.async = false;
document.head.append(runtime);
