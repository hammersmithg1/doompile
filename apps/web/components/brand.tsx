import {
  haloArtwork,
  wordmarkArtwork,
} from "../../../packages/design/artwork.generated";

export function Halo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={haloArtwork.viewBox}
      fill="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: haloArtwork.content }}
    />
  );
}
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-wordmark ${className}`}
      viewBox={wordmarkArtwork.viewBox}
      role="img"
      aria-label="Doompile"
      dangerouslySetInnerHTML={{ __html: wordmarkArtwork.content }}
    />
  );
}
export function BrandIllustration({
  kind,
  className = "",
}: {
  kind: "void" | "cat";
  className?: string;
}) {
  // Decorative artwork; the adjacent Russian text carries the meaning.
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      className={`brand-illustration ${className}`}
      src={`/brand/${kind}.png`}
      alt=""
      width={160}
      height={160}
      draggable={false}
    />
  );
}
export function PileCat() {
  return <BrandIllustration kind="cat" className="pile-cat" />;
}
