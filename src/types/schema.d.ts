export interface CSLJSON {
  type: string;
  title: string;
  author?: { family: string; given?: string }[];
  issued?: { "date-parts": number[][] };
  "container-title"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
}
