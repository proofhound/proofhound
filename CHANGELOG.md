# proofhound

## [0.1.13](https://github.com/proofhound/proofhound/compare/v0.1.12...v0.1.13) (2026-06-19)


### Features

* **core:** tier large run-result and dataset payloads to object storage ([313afdc](https://github.com/proofhound/proofhound/commit/313afdc1c9fe44fa003f171716d60009e6e17e51))

## [0.1.12](https://github.com/proofhound/proofhound/compare/v0.1.11...v0.1.12) (2026-06-19)


### Features

* **core:** add client-direct upload session methods to object storage contract ([#52](https://github.com/proofhound/proofhound/issues/52)) ([8998b50](https://github.com/proofhound/proofhound/commit/8998b50c57970582db0801799a827549fde3a351))


### Bug Fixes

* **web-ui:** guard detail routes against SSR/client hydration mismatch ([#51](https://github.com/proofhound/proofhound/issues/51)) ([0561ab9](https://github.com/proofhound/proofhound/commit/0561ab97cc4aaac45e2dbbe2fe5f06898eab1a96))

## [0.1.11](https://github.com/proofhound/proofhound/compare/v0.1.10...v0.1.11) (2026-06-18)


### Features

* **core:** add object-storage extension point and dataset export delivery ([#48](https://github.com/proofhound/proofhound/issues/48)) ([76359f5](https://github.com/proofhound/proofhound/commit/76359f5f688d70c85c62385967c81ad8975c9aef))

## [0.1.10](https://github.com/proofhound/proofhound/compare/v0.1.9...v0.1.10) (2026-06-18)


### Features

* **web-ui:** route navigation through a host resolveHref seam ([#46](https://github.com/proofhound/proofhound/issues/46)) ([650d398](https://github.com/proofhound/proofhound/commit/650d3984eab5661d347ca6d245d59ba9f6597ff8))

## [0.1.9](https://github.com/proofhound/proofhound/compare/v0.1.8...v0.1.9) (2026-06-17)


### Features

* **releases:** publish deletion history policy ([9838e48](https://github.com/proofhound/proofhound/commit/9838e4866d5433bc27eae96299d5c7559e56ddbd))

## [0.1.8](https://github.com/proofhound/proofhound/compare/v0.1.7...v0.1.8) (2026-06-11)


### Features

* **db:** partition run results by month ([#38](https://github.com/proofhound/proofhound/issues/38)) ([6407656](https://github.com/proofhound/proofhound/commit/640765604641aada80a1e4b51a6376feab06f55f))
* **metering:** add OSS usage metering hooks ([#37](https://github.com/proofhound/proofhound/issues/37)) ([b5a919d](https://github.com/proofhound/proofhound/commit/b5a919d1d7992bbd77e296b6ff9d1770da97bd72))

## [0.1.7](https://github.com/proofhound/proofhound/compare/v0.1.6...v0.1.7) (2026-06-10)


### Bug Fixes

* **release:** title GitHub Releases with the plain version tag ([#31](https://github.com/proofhound/proofhound/issues/31)) ([65b4dac](https://github.com/proofhound/proofhound/commit/65b4dacc321894cbfc62b40ca73e1ce1c8522f15))

## [0.1.6](https://github.com/proofhound/proofhound/compare/proofhound-v0.1.5...proofhound-v0.1.6) (2026-06-09)


### Features

* **contracts:** complete adapter extension points ([#13](https://github.com/proofhound/proofhound/issues/13)) ([d4955b6](https://github.com/proofhound/proofhound/commit/d4955b64c704e4c8c53ea0585ccb5a99521c7408))
* **core:** add quota policy hook ([007c4be](https://github.com/proofhound/proofhound/commit/007c4beffc628b6f69b7c71023b230a63aa88be5))
* thread optional org scope to rate limiting and restyle console shell ([7219b9e](https://github.com/proofhound/proofhound/commit/7219b9e653270f0717335536d426e18aca87f95e))
* **web-ui:** add adaptive refresh and time zones ([0f0fa73](https://github.com/proofhound/proofhound/commit/0f0fa73416fe4494606d706989eb8896173da0bb))
* **web-ui:** interpret datetime-local inputs in the display time zone ([#21](https://github.com/proofhound/proofhound/issues/21)) ([bb32488](https://github.com/proofhound/proofhound/commit/bb32488e313c0d426df7eb832017a68f4f71141a))


### Bug Fixes

* **web:** gate remaining loading states behind the 300ms anti-flash threshold ([#10](https://github.com/proofhound/proofhound/issues/10)) ([d6087e6](https://github.com/proofhound/proofhound/commit/d6087e61ebad13c88a2ea7d8da05217b46b49e76))

## [0.1.5](https://github.com/proofhound/proofhound/compare/proofhound-v0.1.4...proofhound-v0.1.5) (2026-05-29)


### Features

* **server/auth:** channel-aware HTTP entry and ActorKind refactor ([2cb5057](https://github.com/proofhound/proofhound/commit/2cb505787d19af528bac00f251e3aa28475be7f8))
* streaming dataset import, auto-concurrency, and webhook attribution ([3f24203](https://github.com/proofhound/proofhound/commit/3f24203f5b452601fd0311a80d57e70dc18c9295))
* **web/i18n:** resolve default language from Accept-Language and navigator ([f8acc60](https://github.com/proofhound/proofhound/commit/f8acc607ad2077521a08202bf84c78d4f16cefe2))
* **web:** abort in-flight dataset import on page unload ([0119df7](https://github.com/proofhound/proofhound/commit/0119df78f7214b77a22c8762e6d4660e53a7e02b))

## 0.1.4

### Patch Changes

- update README.md

## 0.1.3

### Patch Changes

- update README.md

## 0.1.2

### Patch Changes

- optimize pnpm release script

## 0.1.1

### Patch Changes

- update quick start demo video

## 0.1.0

### Minor Changes

- Switch ProofHound to SemVer product releases.
