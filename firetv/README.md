# CareCircle on the TV

The living-room TV is CareCircle's shared display: the whole family can see what the care
plan needs and who has picked it up. Every screen in this folder reads the same live
`/api/state` that the voice side writes to, so there is no second backend.

This folder started as Amazon's
[React Native Multi-TV App Sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample)
(MIT No Attribution, see [LICENSE](LICENSE)). The care screens are ours; the monorepo layout,
focus handling and build setup are theirs.

## What is here

| Path | What it is |
|---|---|
| `app/` | The Fire OS app: a small native shell (`MainActivity.java`) that opens the live `/tv` board in a WebView and turns a care gap into a heads-up Fire TV notification |
| `packages/shared-ui/` | The React Native screens shared by every target. `screens/CareCircleScreen.tsx` is the ambient care board; `data/careState.ts` polls `/api/state` every 4 seconds |
| `apps/expo-multi-tv/` | The Expo app for Android TV, Apple TV and web. Its web export is what the server hosts at `/tv-native/` |
| `apps/vega/` | The same screens built for Fire TV on Vega OS |

The sample's media screens (Explore, Details, Player, Settings and their data) are still in
`packages/shared-ui`. The drawer opens on the Care Board; the rest is template code we have not
removed yet.

## Building

All commands run from this folder. The JavaScript targets use Yarn 4 workspaces, so run
`yarn install` once first.

**Fire OS app** (needs the Android SDK):

```sh
./gradlew :app:assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

**Web export** (served by the CareCircle server at `/tv-native/`):

```sh
cd apps/expo-multi-tv
npx expo export -p web --output-dir dist-web
cp -R dist-web/. ../../../public/tv-native/
```

The export is built with `experiments.baseUrl` set to `/tv-native`, so every asset path stays
inside that folder. Commit `public/tv-native/` and redeploy the server for the change to go live.

**Local development against the live server:**

```sh
yarn dev:web
```

Set `EXPO_PUBLIC_CARE_API_BASE` to point the screens at a different server (for example a local
one on `http://localhost:5173`).

**Vega OS** (needs the Vega Developer Tools and a Vega Virtual Device):

```sh
cd apps/vega
npm run build:release
```

The Vega target has not been built or run here yet: it needs Amazon's Vega tools installed first.
