export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          agency_id: string
          body: string | null
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["entity_type"] | null
          id: string
          occurred_at: string
          subject: string | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          agency_id: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"] | null
          id?: string
          occurred_at?: string
          subject?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          agency_id?: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"] | null
          id?: string
          occurred_at?: string
          subject?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activities_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      agency_members: {
        Row: {
          agency_id: string
          created_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_members_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_settings: {
        Row: {
          agency_id: string
          integrations: Json
          openrouter_api_key: string | null
          openrouter_model: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          integrations?: Json
          openrouter_api_key?: string | null
          openrouter_model?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          integrations?: Json
          openrouter_api_key?: string | null
          openrouter_model?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_settings_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address_line: string | null
          agency_id: string
          city: string | null
          company_number: string | null
          county: string | null
          created_at: string
          created_by: string | null
          id: string
          lat: number | null
          lead_agent_id: string | null
          lng: number | null
          name: string
          notes: string | null
          phone: string | null
          postcode: string | null
          sector_tags: string[]
          type: string
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address_line?: string | null
          agency_id: string
          city?: string | null
          company_number?: string | null
          county?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number | null
          lead_agent_id?: string | null
          lng?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          postcode?: string | null
          sector_tags?: string[]
          type?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address_line?: string | null
          agency_id?: string
          city?: string | null
          company_number?: string | null
          county?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number | null
          lead_agent_id?: string | null
          lng?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          postcode?: string | null
          sector_tags?: string[]
          type?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_agents: {
        Row: {
          agency_id: string
          company_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          company_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          company_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_agents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_agents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_types: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          label: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          label: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          label?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      contact_agents: {
        Row: {
          agency_id: string
          contact_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          contact_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          contact_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_agents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_agents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_roles: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          label: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          label: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          label?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      contacts: {
        Row: {
          address_line: string | null
          agency_id: string
          city: string | null
          company_id: string | null
          county: string | null
          created_at: string
          created_by: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          lat: number | null
          lead_agent_id: string | null
          lng: number | null
          marketing_opt_in: boolean
          notes: string | null
          phone: string | null
          postcode: string | null
          role: string
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          agency_id: string
          city?: string | null
          company_id?: string | null
          county?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          lat?: number | null
          lead_agent_id?: string | null
          lng?: number | null
          marketing_opt_in?: boolean
          notes?: string | null
          phone?: string | null
          postcode?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          agency_id?: string
          city?: string | null
          company_id?: string | null
          county?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          lat?: number | null
          lead_agent_id?: string | null
          lng?: number | null
          marketing_opt_in?: boolean
          notes?: string | null
          phone?: string | null
          postcode?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_agents: {
        Row: {
          agency_id: string
          created_at: string
          deal_id: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          deal_id: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          deal_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_agents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_agents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_reminders: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          done: boolean
          due_at: string
          id: string
          notified_at: string | null
          title: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          done?: boolean
          due_at: string
          id?: string
          notified_at?: string | null
          title: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          done?: boolean
          due_at?: string
          id?: string
          notified_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_reminders_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_reminders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_stage_events: {
        Row: {
          agency_id: string
          changed_by: string | null
          created_at: string
          deal_id: string
          from_stage: Database["public"]["Enums"]["deal_stage"] | null
          id: string
          to_stage: Database["public"]["Enums"]["deal_stage"]
        }
        Insert: {
          agency_id: string
          changed_by?: string | null
          created_at?: string
          deal_id: string
          from_stage?: Database["public"]["Enums"]["deal_stage"] | null
          id?: string
          to_stage: Database["public"]["Enums"]["deal_stage"]
        }
        Update: {
          agency_id?: string
          changed_by?: string | null
          created_at?: string
          deal_id?: string
          from_stage?: Database["public"]["Enums"]["deal_stage"] | null
          id?: string
          to_stage?: Database["public"]["Enums"]["deal_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_stage_events_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          agency_id: string
          company_id: string | null
          created_at: string
          created_by: string | null
          expected_close: string | null
          hot_terms: string | null
          id: string
          lead_agent_id: string | null
          listing_id: string | null
          notes: string | null
          requirement_id: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          title: string
          updated_at: string
          value: number | null
        }
        Insert: {
          agency_id: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          expected_close?: string | null
          hot_terms?: string | null
          id?: string
          lead_agent_id?: string | null
          listing_id?: string | null
          notes?: string | null
          requirement_id?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          agency_id?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          expected_close?: string | null
          hot_terms?: string | null
          id?: string
          lead_agent_id?: string | null
          listing_id?: string | null
          notes?: string | null
          requirement_id?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "disposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      deep_dive_reports: {
        Row: {
          agency_id: string
          company_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          markdown: string | null
          model: string | null
          sources: string[]
          status: Database["public"]["Enums"]["deep_dive_status"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          markdown?: string | null
          model?: string | null
          sources?: string[]
          status?: Database["public"]["Enums"]["deep_dive_status"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          markdown?: string | null
          model?: string | null
          sources?: string[]
          status?: Database["public"]["Enums"]["deep_dive_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deep_dive_reports_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deep_dive_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      disposal_agents: {
        Row: {
          agency_id: string
          created_at: string
          disposal_id: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          disposal_id: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          disposal_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disposal_agents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_agents_disposal_id_fkey"
            columns: ["disposal_id"]
            isOneToOne: false
            referencedRelation: "disposals"
            referencedColumns: ["id"]
          },
        ]
      }
      disposal_areas: {
        Row: {
          agency_id: string
          availability: string | null
          created_at: string
          disposal_id: string
          id: string
          name: string
          rent_pa: number | null
          size_sqft: number | null
          size_sqm: number | null
          sort_order: number
        }
        Insert: {
          agency_id: string
          availability?: string | null
          created_at?: string
          disposal_id: string
          id?: string
          name: string
          rent_pa?: number | null
          size_sqft?: number | null
          size_sqm?: number | null
          sort_order?: number
        }
        Update: {
          agency_id?: string
          availability?: string | null
          created_at?: string
          disposal_id?: string
          id?: string
          name?: string
          rent_pa?: number | null
          size_sqft?: number | null
          size_sqm?: number | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "disposal_areas_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_areas_disposal_id_fkey"
            columns: ["disposal_id"]
            isOneToOne: false
            referencedRelation: "disposals"
            referencedColumns: ["id"]
          },
        ]
      }
      disposal_documents: {
        Row: {
          agency_id: string
          created_at: string
          disposal_id: string
          doc_type: string
          file_path: string
          id: string
          name: string
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          disposal_id: string
          doc_type?: string
          file_path: string
          id?: string
          name: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          disposal_id?: string
          doc_type?: string
          file_path?: string
          id?: string
          name?: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disposal_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_documents_disposal_id_fkey"
            columns: ["disposal_id"]
            isOneToOne: false
            referencedRelation: "disposals"
            referencedColumns: ["id"]
          },
        ]
      }
      disposals: {
        Row: {
          address_line: string | null
          agency_id: string
          agent_email: string | null
          agent_name: string | null
          agent_phone: string | null
          agent_photo: string | null
          area: string | null
          brochure_url: string | null
          business_rates: number | null
          city: string | null
          company_id: string | null
          contact_id: string | null
          county: string | null
          covers_external: number | null
          covers_internal: number | null
          created_at: string
          created_by: string | null
          description: string | null
          disposal_type: string
          epc_rating: string | null
          estate_charge: number | null
          fit_out_state: string | null
          floors: Json
          for_sale: boolean
          guide_price: number | null
          id: string
          images: Json
          inside_1954_act: boolean | null
          key_features: string[]
          lat: number | null
          lead_agent_id: string | null
          lease_expiry: string | null
          lease_term_years: number | null
          licensing_notes: string | null
          listing_type: string
          lng: number | null
          location_description: string | null
          next_rent_review: number | null
          parking_charge: number | null
          postcode: string | null
          premium: number | null
          premium_raw: string | null
          price_qualifier: string | null
          property_type: string | null
          rateable_value: number | null
          rent_pa: number | null
          rent_period: string | null
          rent_raw: string | null
          rent_review_basis: string | null
          sections: Json
          service_charge: number | null
          size_sqft: number | null
          size_sqm: number | null
          source: string
          source_ref: string | null
          source_updated_at: string | null
          source_url: string | null
          status: string | null
          summary: string | null
          tenure_raw: string | null
          title: string | null
          to_let: boolean
          updated_at: string
          use_class: string | null
          vat_applicable: boolean | null
        }
        Insert: {
          address_line?: string | null
          agency_id: string
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          agent_photo?: string | null
          area?: string | null
          brochure_url?: string | null
          business_rates?: number | null
          city?: string | null
          company_id?: string | null
          contact_id?: string | null
          county?: string | null
          covers_external?: number | null
          covers_internal?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          disposal_type?: string
          epc_rating?: string | null
          estate_charge?: number | null
          fit_out_state?: string | null
          floors?: Json
          for_sale?: boolean
          guide_price?: number | null
          id?: string
          images?: Json
          inside_1954_act?: boolean | null
          key_features?: string[]
          lat?: number | null
          lead_agent_id?: string | null
          lease_expiry?: string | null
          lease_term_years?: number | null
          licensing_notes?: string | null
          listing_type?: string
          lng?: number | null
          location_description?: string | null
          next_rent_review?: number | null
          parking_charge?: number | null
          postcode?: string | null
          premium?: number | null
          premium_raw?: string | null
          price_qualifier?: string | null
          property_type?: string | null
          rateable_value?: number | null
          rent_pa?: number | null
          rent_period?: string | null
          rent_raw?: string | null
          rent_review_basis?: string | null
          sections?: Json
          service_charge?: number | null
          size_sqft?: number | null
          size_sqm?: number | null
          source?: string
          source_ref?: string | null
          source_updated_at?: string | null
          source_url?: string | null
          status?: string | null
          summary?: string | null
          tenure_raw?: string | null
          title?: string | null
          to_let?: boolean
          updated_at?: string
          use_class?: string | null
          vat_applicable?: boolean | null
        }
        Update: {
          address_line?: string | null
          agency_id?: string
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          agent_photo?: string | null
          area?: string | null
          brochure_url?: string | null
          business_rates?: number | null
          city?: string | null
          company_id?: string | null
          contact_id?: string | null
          county?: string | null
          covers_external?: number | null
          covers_internal?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          disposal_type?: string
          epc_rating?: string | null
          estate_charge?: number | null
          fit_out_state?: string | null
          floors?: Json
          for_sale?: boolean
          guide_price?: number | null
          id?: string
          images?: Json
          inside_1954_act?: boolean | null
          key_features?: string[]
          lat?: number | null
          lead_agent_id?: string | null
          lease_expiry?: string | null
          lease_term_years?: number | null
          licensing_notes?: string | null
          listing_type?: string
          lng?: number | null
          location_description?: string | null
          next_rent_review?: number | null
          parking_charge?: number | null
          postcode?: string | null
          premium?: number | null
          premium_raw?: string | null
          price_qualifier?: string | null
          property_type?: string | null
          rateable_value?: number | null
          rent_pa?: number | null
          rent_period?: string | null
          rent_raw?: string | null
          rent_review_basis?: string | null
          sections?: Json
          service_charge?: number | null
          size_sqft?: number | null
          size_sqm?: number | null
          source?: string
          source_ref?: string | null
          source_updated_at?: string | null
          source_url?: string | null
          status?: string | null
          summary?: string | null
          tenure_raw?: string | null
          title?: string | null
          to_let?: boolean
          updated_at?: string
          use_class?: string | null
          vat_applicable?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "disposals_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      external_sends: {
        Row: {
          agency_id: string
          body: string | null
          bounced_at: string | null
          clicked_at: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          delivered_at: string | null
          id: string
          listing_id: string | null
          opened_at: string | null
          pdf_kind: string | null
          provider_id: string | null
          recipient_email: string
          requirement_id: string | null
          sent_by: string
          status: string | null
          subject: string
        }
        Insert: {
          agency_id: string
          body?: string | null
          bounced_at?: string | null
          clicked_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          delivered_at?: string | null
          id?: string
          listing_id?: string | null
          opened_at?: string | null
          pdf_kind?: string | null
          provider_id?: string | null
          recipient_email: string
          requirement_id?: string | null
          sent_by: string
          status?: string | null
          subject: string
        }
        Update: {
          agency_id?: string
          body?: string | null
          bounced_at?: string | null
          clicked_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          delivered_at?: string | null
          id?: string
          listing_id?: string | null
          opened_at?: string | null
          pdf_kind?: string | null
          provider_id?: string | null
          recipient_email?: string
          requirement_id?: string | null
          sent_by?: string
          status?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_sends_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_sends_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_sends_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_sends_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_sends_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "disposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_sends_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_submissions: {
        Row: {
          agency_id: string
          company_name: string | null
          created_at: string
          created_requirement_id: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          max_covers: number | null
          max_premium: number | null
          max_rent: number | null
          max_sqft: number | null
          min_covers: number | null
          min_sqft: number | null
          notes: string | null
          phone: string | null
          property_type: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_locations: string | null
        }
        Insert: {
          agency_id: string
          company_name?: string | null
          created_at?: string
          created_requirement_id?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          max_covers?: number | null
          max_premium?: number | null
          max_rent?: number | null
          max_sqft?: number | null
          min_covers?: number | null
          min_sqft?: number | null
          notes?: string | null
          phone?: string | null
          property_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_locations?: string | null
        }
        Update: {
          agency_id?: string
          company_name?: string | null
          created_at?: string
          created_requirement_id?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          max_covers?: number | null
          max_premium?: number | null
          max_rent?: number | null
          max_sqft?: number | null
          min_covers?: number | null
          min_sqft?: number | null
          notes?: string | null
          phone?: string | null
          property_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_locations?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_submissions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_submissions_created_requirement_id_fkey"
            columns: ["created_requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_reports: {
        Row: {
          agency_id: string
          company_id: string
          company_number: string | null
          created_at: string
          created_by: string | null
          error: string | null
          flags: string[]
          id: string
          payload: Json | null
          risk_rating: Database["public"]["Enums"]["kyc_risk"]
          sources: string[]
          status: Database["public"]["Enums"]["kyc_report_status"]
          summary: Json | null
          updated_at: string
        }
        Insert: {
          agency_id: string
          company_id: string
          company_number?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          flags?: string[]
          id?: string
          payload?: Json | null
          risk_rating?: Database["public"]["Enums"]["kyc_risk"]
          sources?: string[]
          status?: Database["public"]["Enums"]["kyc_report_status"]
          summary?: Json | null
          updated_at?: string
        }
        Update: {
          agency_id?: string
          company_id?: string
          company_number?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          flags?: string[]
          id?: string
          payload?: Json | null
          risk_rating?: Database["public"]["Enums"]["kyc_risk"]
          sources?: string[]
          status?: Database["public"]["Enums"]["kyc_report_status"]
          summary?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_reports_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyc_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          listing_id: string
          reasons: Json
          requirement_id: string
          score: number
          status: Database["public"]["Enums"]["match_status"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          listing_id: string
          reasons?: Json
          requirement_id: string
          score?: number
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          listing_id?: string
          reasons?: Json
          requirement_id?: string
          score?: number
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "disposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agency_id: string
          body: string
          created_at: string
          id: string
          link: string | null
          parent_id: string | null
          read_at: string | null
          recipient_id: string
          sender_id: string
          subject: string | null
        }
        Insert: {
          agency_id: string
          body: string
          created_at?: string
          id?: string
          link?: string | null
          parent_id?: string | null
          read_at?: string | null
          recipient_id: string
          sender_id: string
          subject?: string | null
        }
        Update: {
          agency_id?: string
          body?: string
          created_at?: string
          id?: string
          link?: string | null
          parent_id?: string | null
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agency_id: string
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          agency_id: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          agency_id?: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          linkedin_url: string | null
          phone: string | null
          updated_at: string
          x_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          linkedin_url?: string | null
          phone?: string | null
          updated_at?: string
          x_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          linkedin_url?: string | null
          phone?: string | null
          updated_at?: string
          x_url?: string | null
        }
        Relationships: []
      }
      requirement_agents: {
        Row: {
          agency_id: string
          created_at: string
          requirement_id: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          requirement_id: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          requirement_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirement_agents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_agents_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      requirements: {
        Row: {
          agency_id: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          fit_out_prefs: string[]
          id: string
          lead_agent_id: string | null
          max_covers: number | null
          max_guide_price: number | null
          max_premium: number | null
          max_rent: number | null
          max_sqft: number | null
          min_covers: number | null
          min_sqft: number | null
          notes: string | null
          property_types: string[]
          status: Database["public"]["Enums"]["requirement_status"]
          target_counties: string[]
          target_london_zones: string[]
          target_neighbourhoods: string[]
          target_postcode_districts: string[]
          target_regions: string[]
          target_towns: string[]
          tenure_prefs: Database["public"]["Enums"]["tenure_type"][]
          title: string
          updated_at: string
          use_classes: Database["public"]["Enums"]["use_class"][]
        }
        Insert: {
          agency_id: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          fit_out_prefs?: string[]
          id?: string
          lead_agent_id?: string | null
          max_covers?: number | null
          max_guide_price?: number | null
          max_premium?: number | null
          max_rent?: number | null
          max_sqft?: number | null
          min_covers?: number | null
          min_sqft?: number | null
          notes?: string | null
          property_types?: string[]
          status?: Database["public"]["Enums"]["requirement_status"]
          target_counties?: string[]
          target_london_zones?: string[]
          target_neighbourhoods?: string[]
          target_postcode_districts?: string[]
          target_regions?: string[]
          target_towns?: string[]
          tenure_prefs?: Database["public"]["Enums"]["tenure_type"][]
          title: string
          updated_at?: string
          use_classes?: Database["public"]["Enums"]["use_class"][]
        }
        Update: {
          agency_id?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          fit_out_prefs?: string[]
          id?: string
          lead_agent_id?: string | null
          max_covers?: number | null
          max_guide_price?: number | null
          max_premium?: number | null
          max_rent?: number | null
          max_sqft?: number | null
          min_covers?: number | null
          min_sqft?: number | null
          notes?: string | null
          property_types?: string[]
          status?: Database["public"]["Enums"]["requirement_status"]
          target_counties?: string[]
          target_london_zones?: string[]
          target_neighbourhoods?: string[]
          target_postcode_districts?: string[]
          target_regions?: string[]
          target_towns?: string[]
          tenure_prefs?: Database["public"]["Enums"]["tenure_type"][]
          title?: string
          updated_at?: string
          use_classes?: Database["public"]["Enums"]["use_class"][]
        }
        Relationships: [
          {
            foreignKeyName: "requirements_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirements_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agency_id: string
          assignee_id: string | null
          created_at: string
          created_by: string | null
          details: string | null
          due_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          notified_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          due_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          notified_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          due_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          notified_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_agent: {
        Args: {
          p_agency_id: string
          p_email: string
          p_full_name: string
          p_password: string
          p_role?: Database["public"]["Enums"]["member_role"]
        }
        Returns: string
      }
      admin_set_agent_password: {
        Args: { p_agency_id: string; p_password: string; p_user_id: string }
        Returns: undefined
      }
      admin_update_agent: {
        Args: {
          p_agency_id: string
          p_avatar_url: string
          p_email: string
          p_full_name: string
          p_linkedin_url?: string
          p_phone: string
          p_user_id: string
          p_x_url?: string
        }
        Returns: undefined
      }
      auth_agency_ids: { Args: never; Returns: string[] }
      company_type_in_use: { Args: { p_slug: string }; Returns: number }
      contact_role_in_use: { Args: { p_slug: string }; Returns: number }
      current_agency_openrouter: {
        Args: never
        Returns: {
          api_key: string
          model: string
        }[]
      }
      is_agency_admin: { Args: { p_agency_id: string }; Returns: boolean }
      is_any_agency_admin: { Args: never; Returns: boolean }
      seed_agency: {
        Args: { p_agency_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      activity_type: "call" | "email" | "viewing" | "note" | "meeting" | "task"
      deal_stage:
        | "lead"
        | "viewing"
        | "offer"
        | "heads_of_terms"
        | "legal"
        | "completed"
        | "fell_through"
      deep_dive_status: "pending" | "complete" | "failed"
      entity_type: "company" | "contact" | "listing" | "requirement" | "deal"
      kyc_report_status: "pending" | "complete" | "failed"
      kyc_risk: "low" | "medium" | "high" | "unknown"
      licence_status: "held" | "late" | "none"
      match_status: "suggested" | "shortlisted" | "rejected" | "converted"
      member_role: "admin" | "agent" | "manager"
      requirement_status: "active" | "on_hold" | "satisfied" | "withdrawn"
      tenure_type: "freehold" | "leasehold" | "assignment" | "new_letting"
      use_class:
        | "E"
        | "sui_generis_pub_bar"
        | "sui_generis_nightclub"
        | "sui_generis_hot_food"
        | "A3"
        | "A4"
        | "A5"
        | "other"
        | "pub"
        | "bar"
        | "restaurant"
        | "cafe"
        | "gym"
        | "leisure"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: ["call", "email", "viewing", "note", "meeting", "task"],
      deal_stage: [
        "lead",
        "viewing",
        "offer",
        "heads_of_terms",
        "legal",
        "completed",
        "fell_through",
      ],
      deep_dive_status: ["pending", "complete", "failed"],
      entity_type: ["company", "contact", "listing", "requirement", "deal"],
      kyc_report_status: ["pending", "complete", "failed"],
      kyc_risk: ["low", "medium", "high", "unknown"],
      licence_status: ["held", "late", "none"],
      match_status: ["suggested", "shortlisted", "rejected", "converted"],
      member_role: ["admin", "agent", "manager"],
      requirement_status: ["active", "on_hold", "satisfied", "withdrawn"],
      tenure_type: ["freehold", "leasehold", "assignment", "new_letting"],
      use_class: [
        "E",
        "sui_generis_pub_bar",
        "sui_generis_nightclub",
        "sui_generis_hot_food",
        "A3",
        "A4",
        "A5",
        "other",
        "pub",
        "bar",
        "restaurant",
        "cafe",
        "gym",
        "leisure",
      ],
    },
  },
} as const
