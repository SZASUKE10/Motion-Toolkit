// CEP boot script - declared as <ScriptPath> in CSXS/manifest.xml, so
// After Effects runs this once automatically when the panel is created.
//
// NOTE: don't use $.fileName to find sibling files from here. When this
// file is loaded through the manifest's ScriptPath (instead of a normal
// File > Run Script), $.fileName does not resolve to this file's real
// location on disk - it resolves to a path inside the After Effects
// application folder. That's why the old code here built a path like:
//   C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\modules\anchor.jsx
// instead of this extension's own "host/modules/anchor.jsx".
//
// Host-side .jsx modules (anchor.jsx, and any future ones) are loaded on
// demand from the panel's JS instead, which CAN reliably find this
// extension's folder via csInterface.getSystemPath(SystemPath.EXTENSION).
// See: client/js/modules/anchor.js -> loadAnchorModule()
