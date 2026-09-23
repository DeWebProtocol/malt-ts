//go:build js && wasm

package main

import (
	"encoding/json"
	"strconv"
	"syscall/js"

	"github.com/dewebprotocol/malt-core/auth/coordinate"
	"github.com/dewebprotocol/malt-core/derivation"
)

func registerCoordinateDerivation() {
	js.Global().Set("maltDeriveCoordinate", js.FuncOf(func(_ js.Value, args []js.Value) any {
		fail := func(message string) string {
			raw, _ := json.Marshal(map[string]string{"error": message})
			return string(raw)
		}
		if len(args) != 2 || args[0].Type() != js.TypeNumber || args[1].Type() != js.TypeObject || !args[1].InstanceOf(js.Global().Get("Uint8Array")) {
			return fail("derive expects a profile ID and Uint8Array label")
		}
		number := args[0].Float()
		if number < 0 || number > 255 || number != float64(uint8(number)) {
			return fail("invalid derivation profile ID")
		}
		length := args[1].Get("byteLength").Int()
		if length > 96<<20 {
			return fail("label exceeds size limit")
		}
		label := make([]byte, length)
		js.CopyBytesToGo(label, args[1])
		value, err := derivation.Derive(derivation.ProfileID(uint8(number)), label)
		if err != nil {
			return fail(err.Error())
		}
		result := map[string]any{"kind": string(value.Kind)}
		if value.Kind == coordinate.Index {
			result["index"] = strconv.FormatUint(value.Index, 10)
		} else {
			result["key"] = coordinate.EncodeKey(value.Key)
		}
		raw, err := json.Marshal(result)
		if err != nil {
			return fail(err.Error())
		}
		return string(raw)
	}))
}
