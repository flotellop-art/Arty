export interface PriceResult {
  source: string
  product: string
  price: string
  url: string
}

export interface PriceSearchResponse {
  query: string
  results: PriceResult[]
}

export interface WpPublishRequest {
  title: string
  content: string
  category?: string
  tags?: string[]
  status: 'publish' | 'draft'
}

export interface WpPublishResponse {
  success: boolean
  title: string
  status: string
  url: string
}

export interface FormField {
  selector: string
  value: string
  type?: 'text' | 'select' | 'checkbox' | 'radio' | 'click'
}

export interface FormFillResponse {
  success: boolean
  url: string
  fields: string[]
  submitted: boolean
  screenshot?: string
  error?: string
}

export interface ScreenshotResponse {
  success: boolean
  url: string
  screenshot: string
}
