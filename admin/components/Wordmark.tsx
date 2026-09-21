/**
 * Brand wordmark. "Sahulat" carries the trust gradient, "cart" the cart
 * gradient — brand guidelines §15. In plain text the name is ALWAYS one word,
 * capital S: "Sahulatcart" (§23), so this renders a single unbroken word and
 * only the colour is split.
 */
export default function Wordmark({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const i = lower.lastIndexOf('cart');
  if (i <= 0) return <>{name}</>;
  return (
    <span className="wordmark">
      <span className="wm-sahulat">{name.slice(0, i)}</span>
      <span className="wm-cart">{name.slice(i)}</span>
    </span>
  );
}
