export type ToolMode =
  | 'none'
  | 'text'
  | 'signature'
  | 'draw'
  | 'highlight';

export interface TextAnnotation {
  id: string;
  type: 'text';
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
}

export interface SignatureAnnotation {
  id: string;
  type: 'signature';
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface DrawAnnotation {
  id: string;
  type: 'draw';
  pageIndex: number;
  paths: Array<{ x: number; y: number }[]>;
  color: string;
  lineWidth: number;
}

export interface HighlightAnnotation {
  id: string;
  type: 'highlight';
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export type Annotation =
  | TextAnnotation
  | SignatureAnnotation
  | DrawAnnotation
  | HighlightAnnotation;
