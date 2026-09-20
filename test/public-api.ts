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

void createBrowserMaltWriter({}).then(async writer => {
  const encoded = new TextEncoder().encode('{}')
  const handle = new TextEncoder().encode('1')
  const created: string = await writer.createAuthentication('kzg', encoded)
  const imported: string = await writer.importAuthentication('kzg', encoded)
  const changed: string = await writer.applyAuthentication('kzg', handle, encoded)
  const exported: string = await writer.exportAuthentication('kzg', handle)
  void [created, imported, changed, exported]
  await writer.discardAuthentication('kzg', handle)
  await writer.closeAuthentication('kzg')
})
