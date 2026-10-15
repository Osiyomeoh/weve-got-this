/**
 * Who CareCircle is for. Free Pexels photos of the kinds of families it is built for:
 * models, not CareCircle users, and the captions say nothing about them beyond the photo.
 */

const PEOPLE = [
  {
    src: '/people/parent.jpg',
    alt: 'Two adults help an older man stand up from his bed',
    who: 'A parent getting back on their feet',
    body: 'After a hospital stay, someone has to collect the prescription, drive to the check-up and look in at lunch. CareCircle asks who will take each one.',
    credit: 'Kampus Production',
    href: 'https://www.pexels.com/photo/7551686/',
  },
  {
    src: '/people/wheelchair.jpg',
    alt: 'A young man pushes an older person in a wheelchair down a street',
    who: 'Someone who uses a wheelchair',
    body: 'Rides and a hand at the door are the jobs that slip. CareCircle asks who can take each one before the day comes.',
    credit: 'RDNE Stock project',
    href: 'https://www.pexels.com/photo/6646919/',
  },
  {
    src: '/people/alone.jpg',
    alt: 'A grandmother knits in an armchair beside her granddaughter',
    who: 'A grandparent at home',
    body: 'The TV on the wall shows what today holds and who is coming, so nobody has to remember it all.',
    credit: 'Alex Green',
    href: 'https://www.pexels.com/photo/5692181/',
  },
  {
    src: '/people/special.jpg',
    alt: 'A mother and her daughter, who has Down syndrome, finger painting at a table',
    who: 'A child with special needs',
    body: 'Therapy runs, school pickups and refills are shared between parents and relatives, and nothing is anyone’s until they say yes.',
    credit: 'Antoni Shkraba',
    href: 'https://www.pexels.com/photo/6288114/',
  },
];

export function People() {
  return (
    <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {PEOPLE.map((p) => (
        <figure key={p.who} className="overflow-hidden rounded-2xl border border-line bg-[#0f141c]">
          <img
            src={p.src}
            alt={p.alt}
            loading="lazy"
            className="aspect-[6/5] w-full object-cover"
          />
          <figcaption className="p-5">
            <div className="font-semibold">{p.who}</div>
            <p className="mt-2 text-sm leading-relaxed text-[#c3cad9]">{p.body}</p>
            <a
              href={p.href}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[0.7rem] text-muted hover:text-white"
            >
              Photo: {p.credit} / Pexels
            </a>
          </figcaption>
        </figure>
      ))}
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">
        Stock photos of models, not CareCircle users.
      </p>
    </div>
  );
}
