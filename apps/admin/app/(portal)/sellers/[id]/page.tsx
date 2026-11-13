import type { components } from '@vendra/api-client';
import { ActionForm, Alert, Badge, Card, Field, PageHeader, SubmitButton, Textarea } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { session } from '../../../../lib/session';
import { dateTime } from '../../orders/labels';
import { reviewApplication } from '../actions';
import { CASE_LABEL, DOCUMENT_LABEL, KIND_LABEL, megabytes, SELLER_LABEL, SELLER_TONE } from '../labels';

export const metadata: Metadata = { title: 'Seller application' };

type Profile = components['schemas']['ProfileDto'];
type Document = components['schemas']['DocumentDto'];

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seller = await session.find((api) => api.GET('/v1/admin/sellers/{id}', { params: { path: { id } } }));
  if (!seller) notFound();
  const [latest, ...earlier] = seller.cases;
  const pending = seller.status === 'pending_verification' && latest;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/sellers" className="text-muted underline underline-offset-2">
          Sellers
        </Link>
      </p>
      <PageHeader
        title={seller.profile.displayName}
        description={
          <>
            Applicant {seller.ownerEmail ?? 'unknown'} · started {dateTime.format(new Date(seller.createdAt))}
            {seller.submittedAt ? ` · last sent ${dateTime.format(new Date(seller.submittedAt))}` : ''}
          </>
        }
        actions={<Badge tone={SELLER_TONE[seller.status]}>{SELLER_LABEL[seller.status]}</Badge>}
      />

      <div className="grid max-w-4xl gap-6">
        {seller.sameRegistration.length > 0 ? (
          <Alert tone="warning">
            <strong className="block">Another application gives the same CAC number ({seller.profile.registrationNumber}).</strong>
            {seller.sameRegistration.map((other, index) => (
              <span key={other.id}>
                {index > 0 ? ', ' : ''}
                <Link href={`/sellers/${other.id}`} className="underline underline-offset-2">
                  {other.displayName}
                </Link>{' '}
                ({SELLER_LABEL[other.status].toLowerCase()})
              </span>
            ))}
            . Check which one is the real business before approving.
          </Alert>
        ) : null}

        {seller.status === 'draft' ? <Alert tone="warning">The applicant has not sent this yet. You can review it once they do.</Alert> : null}
        {seller.status === 'changes_requested' ? <Alert tone="warning">Waiting for the applicant to make the changes you asked for and send it again.</Alert> : null}

        <Card className="p-6">
          <h2 className="font-semibold">{pending ? 'What they sent' : 'Current details'}</h2>
          <ProfileList profile={pending ? latest.profile : seller.profile} />
          <h3 className="mt-6 text-sm font-semibold">Documents</h3>
          <Documents sellerId={seller.id} documents={pending ? latest.documents : seller.documents} />
          {seller.missingDocuments.length > 0 ? (
            <p className="mt-2 text-sm text-muted">Not attached: {seller.missingDocuments.map((kind) => DOCUMENT_LABEL[kind]).join(', ')}.</p>
          ) : null}
        </Card>

        {pending ? (
          <Card className="p-6">
            <h2 className="font-semibold">Decision</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              Check the CAC number and registered name on the CAC public search, and that the documents match. Approved sellers cannot list products yet: selling opens after launch.
            </p>
            <ActionForm action={reviewApplication.bind(null, seller.id, seller.version)} className="space-y-4">
              <Field label="Message to the applicant" hint="Needed to reject or ask for changes. The applicant reads it, so be clear and polite.">
                <Textarea name="note" maxLength={1000} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="decision" value="approve">
                  Approve
                </SubmitButton>
                <SubmitButton name="decision" value="request_changes" variant="outline">
                  Ask for changes
                </SubmitButton>
                <SubmitButton name="decision" value="reject" variant="outline">
                  Reject
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {(pending ? earlier : seller.cases).length > 0 ? (
          <Card className="p-6">
            <h2 className="font-semibold">{pending ? 'Earlier submissions' : 'Submissions'}</h2>
            <ol className="mt-4 space-y-5">
              {(pending ? earlier : seller.cases).map((entry) => (
                <li key={entry.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                  <p className="text-sm">
                    <span className="font-medium">Sent {dateTime.format(new Date(entry.submittedAt))}</span> · {CASE_LABEL[entry.status]}
                    {entry.reviewedAt ? ` ${dateTime.format(new Date(entry.reviewedAt))}` : ''}
                  </p>
                  {entry.notes ? <p className="mt-1 text-sm text-muted">“{entry.notes}”</p> : null}
                  <Documents sellerId={seller.id} documents={entry.documents} />
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function ProfileList({ profile }: { profile: Profile }) {
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <Item label="Registered name">{profile.legalName}</Item>
      <Item label="Registered as">
        {KIND_LABEL[profile.businessKind]} · <span className="font-mono">{profile.registrationNumber}</span>
      </Item>
      <Item label="TIN">{profile.taxId ?? 'Not given'}</Item>
      <Item label="Phone">{profile.phone}</Item>
      <Item label="Address">{[profile.address.line1, profile.address.line2, profile.address.city, profile.address.state].filter(Boolean).join(', ')}</Item>
      {profile.description ? <Item label="About the business">{profile.description}</Item> : null}
    </dl>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function Documents({ sellerId, documents }: { sellerId: string; documents: Document[] }) {
  if (documents.length === 0) return <p className="mt-2 text-sm text-muted">No documents.</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {documents.map((document) => (
        <li key={document.id}>
          <a href={`/sellers/${sellerId}/documents/${document.id}`} className="underline underline-offset-2">
            {document.fileName}
          </a>{' '}
          <span className="text-muted">
            · {DOCUMENT_LABEL[document.kind]} · {megabytes(document.sizeBytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}
