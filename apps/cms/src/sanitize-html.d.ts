declare module 'sanitize-html' {
  type Attributes = Record<string,string>;
  interface Options {
    allowedTags?: string[];
    allowedAttributes?: Record<string,string[]>;
    allowedSchemes?: string[];
    allowedSchemesByTag?: Record<string,string[]>;
    allowProtocolRelative?: boolean;
    nonTextTags?: string[];
    transformTags?: Record<string,(tagName:string,attribs:Attributes)=>{tagName:string;attribs:Attributes}>;
  }
  function sanitizeHtml(html:string, options?:Options):string;
  export default sanitizeHtml;
}
