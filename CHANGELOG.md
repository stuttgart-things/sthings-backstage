## [1.3.1](https://github.com/stuttgart-things/sthings-backstage/compare/v1.3.0...v1.3.1) (2026-04-15)


### Bug Fixes

* **stage-image:** accept full image ref in sha input ([#66](https://github.com/stuttgart-things/sthings-backstage/issues/66)) ([115cc88](https://github.com/stuttgart-things/sthings-backstage/commit/115cc882c6a1e9ed18d40eb9b5881b3eefec59ab))

# [1.3.0](https://github.com/stuttgart-things/sthings-backstage/compare/v1.2.1...v1.3.0) (2026-04-15)


### Features

* add on-demand stage-image workflow ([#65](https://github.com/stuttgart-things/sthings-backstage/issues/65)) ([3010f6d](https://github.com/stuttgart-things/sthings-backstage/commit/3010f6dcc75112c75594ae3ef995e2c361899872))

## [1.2.1](https://github.com/stuttgart-things/sthings-backstage/compare/v1.2.0...v1.2.1) (2026-04-15)


### Bug Fixes

* **deps:** update backstage monorepo ([#63](https://github.com/stuttgart-things/sthings-backstage/issues/63)) ([f75dc7e](https://github.com/stuttgart-things/sthings-backstage/commit/f75dc7e9bd269c5ee3187209ba2d3311585b2702))

# [1.2.0](https://github.com/stuttgart-things/sthings-backstage/compare/v1.1.1...v1.2.0) (2026-04-12)


### Features

* **auth:** add scaffolder-scoped externalAccess token ([52cb4ba](https://github.com/stuttgart-things/sthings-backstage/commit/52cb4badd777b3024752cfdc1d0fd942adbd1b9e))

## [1.1.1](https://github.com/stuttgart-things/sthings-backstage/compare/v1.1.0...v1.1.1) (2026-04-07)


### Bug Fixes

* add crane tagging as job in release workflow ([cea3190](https://github.com/stuttgart-things/sthings-backstage/commit/cea319021a9278c6a731ac3cb5f7127aac7ea310))

# [1.1.0](https://github.com/stuttgart-things/sthings-backstage/compare/v1.0.0...v1.1.0) (2026-04-07)


### Bug Fixes

* pass registry username as env secret to dagger modules ([f7fa3ad](https://github.com/stuttgart-things/sthings-backstage/commit/f7fa3ad1700eae9b1fa0b72153db7097e894d2f3))


### Features

* push images to ghcr.io and tag releases with crane ([d1c4c62](https://github.com/stuttgart-things/sthings-backstage/commit/d1c4c623f5f92447bdda7c6a6ff14b6461dafe2d))

# 1.0.0 (2026-04-07)


### Bug Fixes

* bump dagger module versions to v0.90.1 and blueprints to v1.78.1 ([49755bc](https://github.com/stuttgart-things/sthings-backstage/commit/49755bc4a4e5cb45d2e63fe11602950b08887176))
* correct dagger-for-github action version to v8.4.1 ([d616f17](https://github.com/stuttgart-things/sthings-backstage/commit/d616f173aa0068e834df1db1d5d3848dfed96e1c))
* darken light theme background for less glare ([dec8d48](https://github.com/stuttgart-things/sthings-backstage/commit/dec8d48f84b5f7cdd13bf47dd28b2929bb343a79))
* **deps:** update dependency @backstage-community/plugin-github-actions to ^0.21.0 ([13fd292](https://github.com/stuttgart-things/sthings-backstage/commit/13fd292dd3443934fbf2d37fe24d8125cfc325a4))
* **deps:** update dependency @backstage-community/plugin-github-actions to ^0.22.0 ([cb34154](https://github.com/stuttgart-things/sthings-backstage/commit/cb34154d35f5a74e854bf5ff858880b3ea20a979))
* **deps:** update dependency @roadiehq/scaffolder-backend-module-utils to v4 ([cfc28ab](https://github.com/stuttgart-things/sthings-backstage/commit/cfc28abce56536c38cd60000f05e9e4ca882aecd))
* **deps:** update dependency node-fetch to v3 ([b77a0a3](https://github.com/stuttgart-things/sthings-backstage/commit/b77a0a32aef8d1ee7c18e8afe29285baa84dfae2))
* **deps:** update dependency node-gyp to v12 ([d441fb3](https://github.com/stuttgart-things/sthings-backstage/commit/d441fb37eea6456210ec7ccea09b46e9c6025c1a))
* **deps:** update dependency zod to v4 ([1d38665](https://github.com/stuttgart-things/sthings-backstage/commit/1d386659e69827326e648f3c9138883674a5d6b5))
* **deps:** update react-router monorepo to v7 ([8eaa339](https://github.com/stuttgart-things/sthings-backstage/commit/8eaa339aabbff1c14c20fb64a3bee9ada5079635))
* increase sidebar logo and font size ([d71cf35](https://github.com/stuttgart-things/sthings-backstage/commit/d71cf35dc9a94bcf015da9651926f915d118191b))
* resolve TypeScript build errors in claim-machinery plugin files ([55056d8](https://github.com/stuttgart-things/sthings-backstage/commit/55056d8e9b5665fa62ed077aa5812c22324ec654))
* skip TLS verification for claim-machinery proxy endpoints ([5b82a91](https://github.com/stuttgart-things/sthings-backstage/commit/5b82a91cd164db2e8c824197ad9a5584c6b59e61))
* skip TLS verification in scaffolder claim-machinery action ([216916c](https://github.com/stuttgart-things/sthings-backstage/commit/216916c735f2b3f85a738cbfc40018f4e4253268))
* update claim-machinery-api default URL to dev-infra-pre ([ea2aefc](https://github.com/stuttgart-things/sthings-backstage/commit/ea2aefc94d39d472e5c4d7085702301351cb7bdb))
* update sidebar logo text to lowercase sthings with phonetic subtitle ([3c92a53](https://github.com/stuttgart-things/sthings-backstage/commit/3c92a536a07af940259c645e953035cdb4630d02))
* use warm background tones for light theme ([8106f27](https://github.com/stuttgart-things/sthings-backstage/commit/8106f2794c7b4729c89d11de5c930ab526a7923c))


### Features

* add nameOverride parameter to claim-machinery:render action ([9dc2269](https://github.com/stuttgart-things/sthings-backstage/commit/9dc2269cf4be5716671ad35d141d040cd9c0ac91))
* add semantic release for automated versioning ([bbf2455](https://github.com/stuttgart-things/sthings-backstage/commit/bbf2455aa890cae1a86e618d268c1707cec9fa1e))
* bigger logo, Inter font for modern header typography ([6e49484](https://github.com/stuttgart-things/sthings-backstage/commit/6e4948449ce80e0fec940a4dc28605368f8a4bee))
* configure GitHub auth, catalog structure, and pre-commit hooks ([0de059f](https://github.com/stuttgart-things/sthings-backstage/commit/0de059f2a5e366710d5189c4d242c27597cb2830))
* customize catalog header and improve background warmth ([ea0dc04](https://github.com/stuttgart-things/sthings-backstage/commit/ea0dc0463e32006c08e9b442b66885268e47404f))
* enhance UI depth, table styling, and catalog header tagline ([6dc3692](https://github.com/stuttgart-things/sthings-backstage/commit/6dc369217c7efacf6303eb64436c994a77ab14b3)), closes [#0c0e16](https://github.com/stuttgart-things/sthings-backstage/issues/0c0e16)
* enhance UI styling with card elevation, transitions, and polish ([3b5e081](https://github.com/stuttgart-things/sthings-backstage/commit/3b5e081927173c4ffcf87033477ee93b99c634dc))
* feat/add-claim-machinery-api-extension ([a1aed48](https://github.com/stuttgart-things/sthings-backstage/commit/a1aed4815da1098978632e918b231446e9e5a97c))
* feat/add-gh-workflow-roadie-plugin ([f243acc](https://github.com/stuttgart-things/sthings-backstage/commit/f243acc3d6d81b8b78f2f3566492a3c46a923945)), closes [feat/add-#workflow-roadie-plugin](https://github.com/feat/add-/issues/workflow-roadie-plugin)
* feat/add-roadie-utils ([31f9a63](https://github.com/stuttgart-things/sthings-backstage/commit/31f9a63c60be97c6899f5a0d81f7ed042646878a))
* feat/add-scafolder-utils ([cf1a4cc](https://github.com/stuttgart-things/sthings-backstage/commit/cf1a4cc36448133cd81170c6992b97061092706e))
* feat/add-scafolder-utils ([4d82f3f](https://github.com/stuttgart-things/sthings-backstage/commit/4d82f3f2db9e0abe7c80cbcb496bb56e6a6718a4))
* feat/add-sketelton ([75da092](https://github.com/stuttgart-things/sthings-backstage/commit/75da092d2f675d3b8cd34746def6aff44680b7f3))
* feat/add-techdocs-dockerfile ([00df010](https://github.com/stuttgart-things/sthings-backstage/commit/00df010bb4c92ec07507cc1cc6ba541e54b02987))
* featfeat/add-claim-registry-plugin ([3120409](https://github.com/stuttgart-things/sthings-backstage/commit/3120409e9fa6e1df726dfa6fbd1c2594033f9bbf))
* ffix/app-bundle-docker-buik ([7c8a7e4](https://github.com/stuttgart-things/sthings-backstage/commit/7c8a7e49611d43f0cc87f692e087e0fdeaf96870))
* integrate custom logo and sthings branding theme ([6e9d753](https://github.com/stuttgart-things/sthings-backstage/commit/6e9d753f5323436b38b2713fae468782d9c15341)), closes [#3B3084](https://github.com/stuttgart-things/sthings-backstage/issues/3B3084) [#E8A317](https://github.com/stuttgart-things/sthings-backstage/issues/E8A317) [#14](https://github.com/stuttgart-things/sthings-backstage/issues/14)
* main ([e780834](https://github.com/stuttgart-things/sthings-backstage/commit/e7808343662111ea34215880cb5e23aee50ef2dd))
* main ([9ed8fa2](https://github.com/stuttgart-things/sthings-backstage/commit/9ed8fa2d7bf65e1833ad6ceb2a2e93bba0081ac2))
* main ([0c377bf](https://github.com/stuttgart-things/sthings-backstage/commit/0c377bf138c6fdabe765423f5b6e497f2d767ab3))
* main ([f32a7d0](https://github.com/stuttgart-things/sthings-backstage/commit/f32a7d04f56ca91965c5a36db98f0c9dc55136ee))
* main ([47c9f0a](https://github.com/stuttgart-things/sthings-backstage/commit/47c9f0a8219eb41f53ec855c5661338d6dd38399))
* main ([f43bc6c](https://github.com/stuttgart-things/sthings-backstage/commit/f43bc6c32476375f2c272cddce5cf73dab3b330f))
* main ([a30736c](https://github.com/stuttgart-things/sthings-backstage/commit/a30736cb6d732ab2dc911e4ad4bf6b8c5c337772))
* main ([4f82595](https://github.com/stuttgart-things/sthings-backstage/commit/4f82595da93e9fbf560b0696ac80734badd4495a))
* main ([f5f3b71](https://github.com/stuttgart-things/sthings-backstage/commit/f5f3b713fea595cc09e2f29b67948ff99c5c812e))
* main ([52ea8df](https://github.com/stuttgart-things/sthings-backstage/commit/52ea8df154b9e22c14e7fc777fe3e8b0cc49f1c1))
* main ([ad97dfb](https://github.com/stuttgart-things/sthings-backstage/commit/ad97dfbe7437c33b90f6776d0fa816e2888decda))
* update claim-machinery plugin with multiselect and hidden parameter support ([eb64c8a](https://github.com/stuttgart-things/sthings-backstage/commit/eb64c8a8cda8f6a41403f76d3bd2f5c44f41b61d))
* update outdated dependencies (Backstage 1.47.0 → 1.49.3) ([3777087](https://github.com/stuttgart-things/sthings-backstage/commit/3777087c59f81ac055e76f9b5801c52226ebe639)), closes [#13](https://github.com/stuttgart-things/sthings-backstage/issues/13)
