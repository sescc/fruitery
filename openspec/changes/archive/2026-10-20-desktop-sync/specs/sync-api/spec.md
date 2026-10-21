# Spec Delta

## ADDED Requirements

### Requirement: Service-token access
Besides the owner's own sign-in, the API SHALL accept requests that Cloudflare Access has
authenticated with a service token whose client id is in the configured list of allowed tokens.
A service token not in the list, or a deployment with no list configured, SHALL be refused with
403 and a reason code, before any data is touched.

#### Scenario: Allowed token
- **WHEN** a request arrives authenticated by Access with a service token listed as allowed
- **THEN** the request is processed like one from the owner

#### Scenario: Unknown token
- **WHEN** a request arrives with a service token that is not listed
- **THEN** the API answers 403 with reason "service-token-not-allowed" and no data is read or written

#### Scenario: No list configured
- **WHEN** a service-token request arrives and no allowed-token list is configured
- **THEN** the API answers 403 with reason "service-token-ids-missing"
