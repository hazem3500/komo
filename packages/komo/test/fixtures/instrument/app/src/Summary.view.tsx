/** Listed by a dotted file name and imported through an alias. */
export default function Summary({ tone }: { tone: "plain" | "loud" }) {
  return <p className="summary" data-tone={tone}>Summary</p>;
}
