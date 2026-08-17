// Probe: does the SDK import at all on this Node, and what does it export?
import * as sdk from "@terminal3/t3n-sdk";
console.log("node:", process.version);
console.log("sdk keys:", Object.keys(sdk).sort().join("\n  "));
