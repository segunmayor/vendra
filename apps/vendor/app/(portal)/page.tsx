import { getPublicSettings, text } from '@vendra/portal-session/server';
import { ActionForm, Alert, Badge, Card, EmptyState, Field, Input, Select, SubmitButton, Textarea } from '@vendra/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { type Application, dateTime, DOCUMENT_HINT, DOCUMENT_LABEL, type DocumentKind, megabytes, type Requirements, STATUS } from '../../lib/labels';
import { session } from '../../lib/session';
import { STATES } from '../../lib/states';
import { removeDocument, saveDetails, submitApplication, uploadDocument } from './actions';

export const metadata: Metadata = { title: 'Application' };

export default async function ApplicationPage() {
  const [{ application, requirements }, settings] = await Promise.all([session.read((api) => api.GET('/v1/vendor/application')), getPublicSettings()]);
  const name = text(settings, 'store.name');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Sell on {name}</h1>
        {application ? <Badge tone={STATUS[application.status].tone}>{STATUS[application.status].label}</Badge> : null}
      </div>

      {!application && !requirements.open ? (
        <EmptyState title="Applications are closed">We are not taking new seller applications at the moment. Please check back later.</EmptyState>
      ) : (
        <div className="grid max-w-3xl gap-6">
          <Status application={application ?? null} requirements={requirements} />
          <Details application={application ?? null} />
          {application ? <Documents application={application} requirements={requirements} /> : null}
          {application?.editable ? <Submit application={application} /> : null}
        </div>
      )}
    </>
  );
}

function Status({ application, requirements }: { application: Application | null; requirements: Requirements }) {
  if (!application) {
    return (
      <Card className="p-6">
        <h2 className="font-semibold">How it works</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>Tell us about your business, as registered with the Corporate Affairs Commission (CAC).</li>
          <li>
            {requirements.requiredDocuments.length > 0 ? `Attach your documents: ${list(requirements.requiredDocuments)}.` : 'Attach any documents that support your application.'}
          </li>
          <li>Send it for review. We check your details and let you know here.</li>
        </ol>
      </Card>
    );
  }
  const note = application.decision?.note;
  switch (application.status) {
    case 'pending_verification':
      return (
        <Alert tone="warning">
          We are reviewing your application{application.submittedAt ? `, sent ${dateTime.format(new Date(application.submittedAt))}` : ''}. You cannot change it while we review it.
        </Alert>
      );
    case 'changes_requested':
      return (
        <Alert tone="warning">
          <strong className="block">We need you to change something before we can verify your business.</strong>
          {note}
        </Alert>
      );
    case 'active':
      return <Alert tone="success">{requirements.approvedMessage}</Alert>;
    case 'rejected':
      return (
        <Alert>
          <strong className="block">We could not approve your application.</strong>
          {note}
        </Alert>
      );
    default:
      return null;
  }
}

function Details({ application }: { application: Application | null }) {
  const profile = application?.profile;
  if (application && !application.editable && profile) {
    return (
      <Card className="p-6">
        <h2 className="font-semibold">Business details</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="Shop name">{profile.displayName}</Item>
          <Item label="Registered name">{profile.legalName}</Item>
          <Item label="CAC number">{profile.registrationNumber}</Item>
          <Item label="TIN">{profile.taxId ?? 'Not given'}</Item>
          <Item label="Phone">{profile.phone}</Item>
          <Item label="Address">
            {[profile.address.line1, profile.address.line2, profile.address.city, profile.address.state].filter(Boolean).join(', ')}
          </Item>
          {profile.description ? <Item label="About the business">{profile.description}</Item> : null}
        </dl>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <h2 className="font-semibold">{application ? 'Business details' : 'Start your application'}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">Use the details exactly as they appear on your CAC certificate.</p>
      <ActionForm action={saveDetails.bind(null, application?.version ?? null)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Shop name" hint="The name customers will see.">
          <Input name="displayName" required minLength={2} maxLength={80} defaultValue={profile?.displayName} />
        </Field>
        <Field label="Registered business name">
          <Input name="legalName" required minLength={2} maxLength={160} defaultValue={profile?.legalName} />
        </Field>
        <Field label="Registered as">
          <Select key={`kind-${application?.version ?? 0}`} name="businessKind" required defaultValue={profile?.businessKind ?? 'company'}>
            <option value="company">Company (RC number)</option>
            <option value="business_name">Business name (BN number)</option>
          </Select>
        </Field>
        <Field label="CAC number" hint="For example RC 1234567 or BN 1234567.">
          <Input name="registrationNumber" required maxLength={20} defaultValue={profile?.registrationNumber} autoCapitalize="characters" />
        </Field>
        <Field label="TIN" hint="Optional, for example 12345678-0001.">
          <Input name="taxId" maxLength={20} defaultValue={profile?.taxId ?? ''} />
        </Field>
        <Field label="Business phone" hint="A Nigerian mobile number.">
          <Input name="phone" type="tel" required inputMode="tel" autoComplete="tel" maxLength={20} defaultValue={profile?.phone} />
        </Field>
        <Field label="Street address" className="sm:col-span-2">
          <Input name="line1" required minLength={3} maxLength={160} autoComplete="address-line1" defaultValue={profile?.address.line1} />
        </Field>
        <Field label="Address line 2" hint="Optional." className="sm:col-span-2">
          <Input name="line2" maxLength={160} autoComplete="address-line2" defaultValue={profile?.address.line2 ?? ''} />
        </Field>
        <Field label="Town or city">
          <Input name="city" required minLength={2} maxLength={80} autoComplete="address-level2" defaultValue={profile?.address.city} />
        </Field>
        <Field label="State">
          <Select key={`state-${application?.version ?? 0}`} name="state" required defaultValue={profile?.address.state ?? ''}>
            <option value="" disabled>
              Choose a state
            </option>
            {STATES.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </Select>
        </Field>
        <Field label="About the business" hint="Optional. What you sell, and for how long." className="sm:col-span-2">
          <Textarea name="description" maxLength={1000} defaultValue={profile?.description ?? ''} />
        </Field>
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Saving…">{application ? 'Save details' : 'Save and continue'}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

/** "a, b and c", keeping each label's own capitals (CAC, ID). */
function list(kinds: readonly DocumentKind[]): string {
  const labels = kinds.map((kind) => DOCUMENT_LABEL[kind]);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : (labels[0] ?? '');
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function Documents({ application, requirements }: { application: Application; requirements: Requirements }) {
  const required = new Set<DocumentKind>(requirements.requiredDocuments);
  return (
    <Card className="p-6">
      <h2 className="font-semibold">Documents</h2>
      <p className="mt-1 text-sm text-muted">
        {application.editable ? `PDF or a clear photo (JPEG, PNG or WebP), up to ${megabytes(requirements.maxDocumentBytes)} each. ` : ''}Only our verification team can see them.
      </p>

      {requirements.requiredDocuments.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm" aria-label="Required documents">
          {requirements.requiredDocuments.map((kind) => {
            const done = !application.missingDocuments.includes(kind);
            return (
              <li key={kind} className="flex items-start gap-2">
                <span aria-hidden className={done ? 'text-[#0b6b52]' : 'text-muted'}>
                  {done ? '✓' : '○'}
                </span>
                <span>
                  {DOCUMENT_LABEL[kind]}
                  <span className="sr-only">{done ? ', attached' : ', still needed'}</span>
                  {done ? null : <span className="block text-xs text-muted">{DOCUMENT_HINT[kind]}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {application.documents.length > 0 ? (
        <ul className="mt-4 divide-y divide-border rounded-brand border border-border">
          {application.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <a href={`/documents/${document.id}`} className="block truncate font-medium underline underline-offset-2">
                  {document.fileName}
                </a>
                <span className="text-xs text-muted">
                  {DOCUMENT_LABEL[document.kind]} · {megabytes(document.sizeBytes)}
                </span>
              </div>
              {application.editable ? (
                <ActionForm action={removeDocument.bind(null, document.id)}>
                  <SubmitButton size="sm" variant="outline" pendingLabel="Removing…">
                    Remove<span className="sr-only"> {document.fileName}</span>
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {application.editable ? (
        <ActionForm action={uploadDocument.bind(null, requirements.maxDocumentBytes)} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="What is it?">
            <Select key={`kind-${application.version}`} name="kind" required defaultValue={application.missingDocuments[0] ?? 'other'}>
              {requirements.documentKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {DOCUMENT_LABEL[kind]}
                  {required.has(kind) ? ' (required)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="File">
            <Input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="py-1.5" />
          </Field>
          <SubmitButton pendingLabel="Uploading…">Attach</SubmitButton>
        </ActionForm>
      ) : null}
    </Card>
  );
}

function Submit({ application }: { application: Application }) {
  const missing = application.missingDocuments;
  const again = application.status === 'changes_requested';
  return (
    <Card className="p-6">
      <h2 className="font-semibold">{again ? 'Send it again' : 'Send for review'}</h2>
      {missing.length > 0 ? (
        <p className="mt-2 text-sm text-muted">Attach these before you send your application: {list(missing)}.</p>
      ) : (
        <>
          <p className="mt-1 mb-4 text-sm text-muted">
            Check your details and documents first. You cannot change them while we review your application.
          </p>
          <ActionForm action={submitApplication.bind(null, application.version)}>
            <SubmitButton pendingLabel="Sending…">{again ? 'Send again' : 'Send for review'}</SubmitButton>
          </ActionForm>
        </>
      )}
    </Card>
  );
}
