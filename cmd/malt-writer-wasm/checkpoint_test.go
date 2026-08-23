package main

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestSessionSnapshotRoundTripAndAuthentication(t *testing.T) {
	computer, err := newComputer("kzg")
	if err != nil {
		t.Fatal(err)
	}
	source, err := newSessionComputer(computer)
	if err != nil {
		t.Fatal(err)
	}
	bootstrap, err := source.bootstrap(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	key := []byte("0123456789abcdef0123456789abcdef")
	snapshot, err := source.snapshot(key)
	if err != nil {
		t.Fatal(err)
	}
	source.closeSession()

	restored, err := newSessionComputer(computer)
	if err != nil {
		t.Fatal(err)
	}
	view, err := restored.restore(context.Background(), snapshot, key)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(view, bootstrap) {
		t.Fatalf("restored view differs:\n got: %s\nwant: %s", view, bootstrap)
	}
	if _, err := restored.snapshot(key); err != nil {
		t.Fatalf("snapshot restored session: %v", err)
	}

	wrongKey, err := newSessionComputer(computer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wrongKey.restore(
		context.Background(),
		snapshot,
		[]byte("fedcba9876543210fedcba9876543210"),
	); err == nil {
		t.Fatal("snapshot restored with the wrong checkpoint key")
	}

	var envelope map[string]any
	if err := json.Unmarshal(snapshot, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope["materialization_sha256"] = "00"
	tampered, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	corrupt, err := newSessionComputer(computer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := corrupt.restore(context.Background(), tampered, key); err == nil {
		t.Fatal("snapshot restored after materialization digest mutation")
	}
}
