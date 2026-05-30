"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateOrgBranding } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Organization } from "@/lib/db/types";

export function OrgBrandingForm({ org }: { org: Organization }) {
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description);
  const [city, setCity] = useState(org.city ?? "");
  const [region, setRegion] = useState(org.region ?? "");
  const [country, setCountry] = useState(org.country ?? "");
  const [website, setWebsite] = useState(org.website ?? "");
  const [contactEmail, setContactEmail] = useState(org.contact_email ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "" || description.trim() === "") {
          toast.error("Name and description are required.");
          return;
        }
        startTransition(() => {
          void updateOrgBranding(org.id, {
            name,
            description,
            city,
            region,
            country,
            website,
            contactEmail,
          }).then((result) => {
            if (result.ok) {
              toast.success("Saved.");
            } else {
              toast.error(result.error);
            }
          });
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="b-name">Name</Label>
        <Input
          id="b-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          maxLength={120}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="b-description">Description</Label>
        <textarea
          id="b-description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          rows={3}
          maxLength={500}
          className="min-h-20 rounded-md border bg-background px-3 py-2 text-ui outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="b-city">City</Label>
          <Input
            id="b-city"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="b-region">Region / State</Label>
          <Input
            id="b-region"
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="b-country">Country</Label>
          <Input
            id="b-country"
            value={country}
            onChange={(event) => {
              setCountry(event.target.value);
            }}
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="b-website">Website</Label>
          <Input
            id="b-website"
            type="url"
            placeholder="https://"
            value={website}
            onChange={(event) => {
              setWebsite(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="b-contact">Contact email</Label>
          <Input
            id="b-contact"
            type="email"
            value={contactEmail}
            onChange={(event) => {
              setContactEmail(event.target.value);
            }}
          />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
