import {readFileSync} from 'node:fs';
import {summarizeNoInspector} from './no-inspector-summary.mjs';
if(!process.argv[2])throw new Error('Provide an explicit no-inspector memory.json path');
console.log(JSON.stringify(summarizeNoInspector(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
