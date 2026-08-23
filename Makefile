.PHONY: test test-js typecheck audit-core-release wasm check-wasm test-wasm

WASM_OUT ?= assets

test: test-js typecheck

test-js:
	npm test

typecheck:
	npm run typecheck

audit-core-release:
	./scripts/audit-core-release.sh

wasm:
	./scripts/build-wasm.sh "$(WASM_OUT)"

check-wasm:
	./scripts/check-wasm.sh "$(WASM_OUT)"

test-wasm: wasm check-wasm
	./scripts/run-verifier-conformance.sh "$(WASM_OUT)/verifier"
	./scripts/run-writer-conformance.sh "$(WASM_OUT)/writer"
