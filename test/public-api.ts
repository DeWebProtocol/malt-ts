import {
  createBrowserMaltWriter,
  createBrowserVerifierLease,
  loadBrowserVerifier,
  maltCoreRelease,
  releaseBrowserVerifier,
  verifyResolveLocally,
  type MaltBackend
} from '@dewebprotocol/malt'
import { maltWasmAssetsDirectory, versionedWasmAssetsPlugin } from '@dewebprotocol/malt/vite'

const backend: MaltBackend = 'kzg'
void backend
void maltCoreRelease.commit
void maltWasmAssetsDirectory()
void versionedWasmAssetsPlugin()
const lease = createBrowserVerifierLease()
void loadBrowserVerifier({ lease }).then(() => releaseBrowserVerifier(lease))
void verifyResolveLocally({ request: {}, result: {} })
void createBrowserMaltWriter({ ipaPreference: 'auto' })
