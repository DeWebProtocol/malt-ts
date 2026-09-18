package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/dewebprotocol/malt-core/auth/engine"
	"github.com/dewebprotocol/malt-core/auth/input"
	"github.com/dewebprotocol/malt-core/protocol"
	"github.com/dewebprotocol/malt-core/sdk/authentication"
)

func (c *computer) prepareAuthentication(ctx context.Context, data []byte) ([]byte, error) {
	if c == nil {
		return nil, fmt.Errorf("writer is not initialized")
	}
	state, err := protocol.DecodeAuthenticationState(data)
	if err != nil {
		return nil, err
	}
	e, err := c.authenticationEngine()
	if err != nil {
		return nil, err
	}
	candidate, err := authentication.Prepare(ctx, e, state)
	if err != nil {
		return nil, err
	}
	return json.Marshal(candidate)
}

func (c *computer) authenticationEngine() (*engine.Engine, error) {
	if c == nil {
		return nil, fmt.Errorf("writer is not initialized")
	}
	profiles := engine.NewRegistry()
	for _, scheme := range c.schemes {
		profile, ok := scheme.(engine.ProfileVerifier)
		if !ok {
			return nil, fmt.Errorf("writer scheme has no VC profile")
		}
		if err := profiles.Register(profile); err != nil {
			return nil, err
		}
	}
	return engine.New(input.DefaultRegistry(), profiles), nil
}
func (c *computer) updateAuthentication(ctx context.Context, baseJSON, stateJSON []byte) ([]byte, error) {
	base, err := protocol.DecodeAuthenticationCandidate(baseJSON)
	if err != nil {
		return nil, err
	}
	state, err := protocol.DecodeAuthenticationState(stateJSON)
	if err != nil {
		return nil, err
	}
	e, err := c.authenticationEngine()
	if err != nil {
		return nil, err
	}
	candidate, err := authentication.PrepareUpdate(ctx, e, base, state)
	if err != nil {
		return nil, err
	}
	return json.Marshal(candidate)
}
