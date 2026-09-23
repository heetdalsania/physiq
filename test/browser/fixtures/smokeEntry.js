/* Bundled by poseSmoke.browser.mjs into a throw-away page. Exposes the
   app's REAL adapter so the smoke test runs the shipped MediaPipe runtime,
   WASM and model through exactly the code path the app uses. */
import { createMediaPipePoseProvider } from "../../../js/movement/poseProvider.js";
import { normalizePoseResult, BLAZEPOSE_INDEX } from "../../../js/movement/poseContract.js";
import { evaluateCalibration } from "../../../js/movement/calibration.js";

window.__smoke = { createMediaPipePoseProvider, normalizePoseResult, BLAZEPOSE_INDEX, evaluateCalibration };
