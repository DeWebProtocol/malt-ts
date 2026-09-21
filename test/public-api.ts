import {
  createBrowserMaltWriter,
  createBrowserVerifierLease,
  loadBrowserVerifier,
  maltCoreRelease,
  releaseBrowserVerifier,
  verifyAuthenticationLocally,
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
void verifyAuthenticationLocally({ request: { profile: 'malt.authentication/1', root: 'root', operation: 'resolve', steps: [] }, result: {} })
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
  await writer.validateAuthenticationBatch('kzg', encoded)
  await writer.validateAuthenticationReceipt('kzg', encoded, encoded)
  await writer.closeAuthentication('kzg')
})

// @ts-expect-error retired query profiles are not accepted by the public verifier
const retiredQuery: import("../types/verifier").AuthenticationRequest = { profile: "malt.authentication/0", root: "root", operation: "resolve", steps: [] }
void retiredQuery
