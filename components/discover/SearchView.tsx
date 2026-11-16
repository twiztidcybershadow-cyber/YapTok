import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { ClipGrid } from "@/components/feed/ClipGrid";
import { SearchIcon, VerifiedIcon } from "@/components/icons";
import type { Creator, DiscoverData, SearchResults, TagCount } from "@/lib/discover/types";
import { compactCount } from "@/lib/feed/format";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8" data-section={title}>
      <h2 className="mb-3 text-[16px] font-bold text-text">{title}</h2>
      {children}
    </section>
  );
}

function Tags({ tags, linked }: { tags: TagCount[]; linked: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((t) => {
        const inner = (
          <>
            <span className="font-medium text-text">#{t.tag}</span>
            <span className="text-text-2">
              {compactCount(t.clips)} clip{t.clips === 1 ? "" : "s"}
            </span>
          </>
        );
        const cls = "flex h-10 items-center gap-2 rounded-full border border-divider px-4 text-[14px]";
        return (
          <li key={t.tag}>
            {linked ? (
              <Link href={`/tag/${t.tag}`} prefetch={false} className={`${cls} hover:bg-hover`}>
                {inner}
              </Link>
            ) : (
              <span className={cls}>{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function People({ people }: { people: Creator[] }) {
  return (
    <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {people.map((p) => (
        <li key={p.id} className="shrink-0">
          <Link href={`/@${p.username}`} prefetch={false} className="card flex w-[132px] flex-col items-center gap-1.5 px-3 py-4 text-center hover:bg-hover">
            <Avatar name={p.displayName} url={p.avatarUrl} size={56} />
            <span className="flex max-w-full items-center gap-1 text-[14px] font-medium text-text">
              <span className="truncate">@{p.username}</span>
              {p.verified && <VerifiedIcon className="h-3.5 w-3.5 shrink-0" />}
            </span>
            <span className="text-[12px] text-text-2">{compactCount(p.followerCount)} followers</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The search page. Before anything is typed it shows what is popular (the
 * discover flag); with a query it shows people, hashtags and clips. The box
 * is a plain GET form, so it works without scripts and the address can be shared.
 */
export function SearchView({
  q,
  results,
  discover,
  mediaBase,
  tagsOn,
}: {
  q: string;
  results: SearchResults | null;
  discover: DiscoverData | null;
  mediaBase: string | null;
  tagsOn: boolean;
}) {
  const nothing = results && results.people.length === 0 && results.tags.length === 0 && results.clips.length === 0;
  return (
    <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6" data-search>
      <form method="get" action="/search" role="search" className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-icon" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search clips, people and hashtags"
          aria-label="Search"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="search"
          className="field !rounded-full !pl-12"
        />
      </form>

      {q.length === 1 && <p className="mt-6 text-[14px] text-text-2">Type at least two characters.</p>}

      {results && nothing && (
        <div className="mt-16 text-center" data-search-empty>
          <p className="text-[16px] font-medium text-text">Nothing found for &quot;{q}&quot;</p>
          <p className="mt-1 text-[14px] text-text-2">Check the spelling or try a shorter word.</p>
        </div>
      )}
      {results && !nothing && (
        <>
          {results.people.length > 0 && (
            <Section title="People">
              <People people={results.people} />
            </Section>
          )}
          {results.tags.length > 0 && (
            <Section title="Hashtags">
              <Tags tags={results.tags} linked={tagsOn} />
            </Section>
          )}
          {results.clips.length > 0 && (
            <Section title="Clips">
              <ClipGrid clips={results.clips} mediaBase={mediaBase} />
            </Section>
          )}
        </>
      )}

      {!results && discover && (
        <>
          {discover.tags.length > 0 && (
            <Section title="Trending hashtags">
              <Tags tags={discover.tags} linked={tagsOn} />
            </Section>
          )}
          {discover.creators.length > 0 && (
            <Section title="Creators to follow">
              <People people={discover.creators} />
            </Section>
          )}
          {discover.clips.length > 0 && (
            <Section title="Popular this week">
              <ClipGrid clips={discover.clips} mediaBase={mediaBase} />
            </Section>
          )}
          {discover.tags.length + discover.creators.length + discover.clips.length === 0 && (
            <p className="mt-16 text-center text-[14px] text-text-2">Nothing is trending yet. Be the first to post.</p>
          )}
        </>
      )}
      {!results && !discover && q.length === 0 && <p className="mt-16 text-center text-[14px] text-text-2">Search for a clip, a creator or a hashtag.</p>}
    </div>
  );
}
