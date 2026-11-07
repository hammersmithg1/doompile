// Safari-generated event pages can inherit a legacy charset. Preserve literals under any charset.
export function asciiScript(source){return source.replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}
