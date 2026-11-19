require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@sanity/client');
const { toHTML } = require('@portabletext/to-html');
const fs = require('fs');
const path = require('path');

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  useCdn: false,
  apiVersion: '2023-05-01',
  token: process.env.SANITY_TOKEN,
});

function blocksToText(blocks) {
  if (!blocks || !Array.isArray(blocks)) return '';
  return blocks
    .map(block => {
      if (block._type !== 'block' || !block.children) return '';
      return block.children.map(child => child.text).join('');
    })
    .join(' ');
}

async function run() {
  console.log('--- Starter henting fra Sanity ---');

  try {
    const data = await client.fetch(`{
      "oppsett": *[_type == "siteSettings"][0],
      "biler": *[_type == "car"] { 
        ..., 
        "mainImageUrl": mainImage.asset->url,
        "galleryUrls": gallery[].asset->url,
        fuel,
        body,
        drive,
        gear,
        numberofgears,
        doors,
        seats,
        lversion,
        performancehk,
        performancewatt,
        torque,
        numberofengines,
        cotwoemission,
        range,
        grossbattery,
        netbattery,
        chargingdc,
        maxhomechargeac,
        onephasehomechargeac,
        chargingspeed,
        powerusage,
        warranty,
        batterywarranty,
        warrantypaint,
        warrantyrust,
        allowedtotalweight,
        kerbweight,
        kerbweightexdriver,
        payloadincdriver,
        maxroofload,
        trailerwbreak,
        trailerwobreak,
        maxbootcapacity,
        minbootcapacity,
        length,
        widthwomirrors,
        widthwmirrors,
        height,
        wheelbase,
        turningcircle,
        yearmodel,
        color,
        interior,
        interest,
        towbar,
        equipment,
        description,
        pricezero,
        pricesixty,
        pricehundred,
        priceadszero,
        quote,
        shopimage,
        alttext,
        mainimages,
        shortterm,
        pricecomment,
        salesman,
        availability,
        consultant,
        sourceslug,
        sourceslugad,
        chosepage,
        shop,
        frontpage,
        campaign,
        fastdelivery,
        metatitle,
        metadescription,
        opengraphtitle,
        opengraphdescription
      },
      "kategorier": *[_type == "categoryPage"] {
        title,
        "slug": slug.current,
        description,
        body
      },
      "omtaler": *[_type == "review"] | order(date desc) {
        ...
      },
      "alle_poster": *[_type == "post"] {
        ...,
        "kategoriNavn": category,
        "bildeUrl": mainImage.asset->url,
        excerpt
      }
    }`);

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// --- 1. OMTALER ---
// ====================================================
    let omtalerFinal = data.omtaler || [];
    const csvPath = path.join(dataDir, 'omtaler.csv');

    if (fs.existsSync(csvPath)) {
      const csvData = fs.readFileSync(csvPath, 'utf8');
      const lines = csvData.split('\n').filter(line => line.trim() !== '');
      const headers = lines[0].split(',');
      const nameIdx = headers.indexOf('name');
      const answerIdx = headers.indexOf('answer');

      if (nameIdx !== -1 && answerIdx !== -1) {
        const csvMap = {};
        lines.slice(1).forEach(line => {
          const cols = line.split(',');
          if (cols[nameIdx] && cols[answerIdx]) {
            csvMap[cols[nameIdx].trim()] = cols[answerIdx].trim();
          }
        });

        omtalerFinal = omtalerFinal.map(omtale => {
          if (!omtale.answer || omtale.answer === null) {
            const fallbackAnswer = csvMap[omtale.author];
            if (fallbackAnswer) return { ...omtale, answer: fallbackAnswer };
          }
          return omtale;
        });
      }
    }

    omtalerFinal.sort((a, b) => new Date(b.date) - new Date(a.date));
    fs.writeFileSync(path.join(dataDir, 'reviews.json'), JSON.stringify(omtalerFinal, null, 2));
    console.log(`✅ Sortert og lagret ${omtalerFinal.length} omtaler.`);

    // content/omtaler/_index.md (gjør at layouts/omtaler/ brukes; dataene ligger i data/reviews.json)
    const omtalerDir = path.join(__dirname, 'content', 'omtaler');
    fs.mkdirSync(omtalerDir, { recursive: true });
    fs.writeFileSync(path.join(omtalerDir, '_index.md'), `---\ntitle: "Kundeomtaler"\nurl: "/omtaler/"\n---`);
    
// --- 2. ARTIKLER / BLOGG ---
// ====================================================
    const postBaseDir = path.join(__dirname, 'content', 'post');
    if (fs.existsSync(postBaseDir)) {
        console.log('Sweep: Rydder gamle artikler...');
        fs.rmSync(postBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(postBaseDir, { recursive: true });

    const artiklerFiltered = (data.alle_poster || []).filter(p => {
      const cat = (p.kategoriNavn || "").toLowerCase();
      return cat !== 'employee' && cat !== 'ansatt';
    });

    artiklerFiltered.forEach(post => {
      const rawCategory = post.kategoriNavn || 'Generelt';
      const catSlug = rawCategory.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-');
      const postDir = path.join(postBaseDir, catSlug);
      
      if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });

      const indexFile = path.join(postDir, '_index.md');
      if (!fs.existsSync(indexFile)) {
          fs.writeFileSync(indexFile, `---\ntitle: "${rawCategory}"\nlayout: "list"\n---`);
      }

      const slug = post.slug?.current || post.title.toLowerCase().replace(/\s+/g, '-');
      const bodyHtml = toHTML(post.body || []);
      
      const content = `---
title: "${(post.title || '').replace(/"/g, '\\"')}"
excerpt: "${(post.excerpt || '').replace(/"/g, '\\"').replace(/\n/g, ' ')}"
date: "${post.publishedAt || new Date().toISOString()}"
kategori: "${rawCategory.toLowerCase()}"
bildeUrl: "${post.bildeUrl || ''}"
bodyHtml: "${bodyHtml.replace(/"/g, '\\"').replace(/\n/g, '')}"
layout: "body"
---`;

      fs.writeFileSync(path.join(postDir, `${slug}.md`), content);
    });

    console.log(`✅ Lagret ${artiklerFiltered.length} artikler i kategoriserte mapper.`);

// --- 4. ANSATTE ---
// ====================================================
    const ansatte = (data.alle_poster || []).filter(p => {
      const cat = (p.kategoriNavn || "").toLowerCase();
      const title = (p.title || "").toLowerCase();
      return cat === 'employee' || cat === 'ansatt' || title.includes('jørgen') || title.includes('mattias') || title.includes('kenneth');
    });

    // /om-oss/ og /om-oss/kontakt/ (fra Sanity "page" med slug om-oss / kontakt, ellers standardtekst)
    const omOssDir = path.join(__dirname, 'content', 'om-oss');
    fs.mkdirSync(omOssDir, { recursive: true });

    const sider = await client.fetch(`*[_type == "page" && slug.current in ["om-oss", "kontakt"]] { title, "slug": slug.current, heroTitle, heroText, content }`);
    const esc = (t) => String(t || '').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');

    const SIDE_DEFAULTS = {
      'om-oss': {
        file: '_index.md',
        title: 'Om Varebilleasing.no',
        meta: 'Varebilleasing.no er en tjeneste fra Automedia AS. Vi gjør det enklere å lease varebil, med personlig oppfølging og konkurransedyktige vilkår.',
        body: '<p>Varebilleasing.no er en tjeneste fra Automedia AS, som gjør det enklere å lease varebil, både for privatpersoner og bedrifter. Vi kombinerer leasing, markedsføring og teknologi for å gi kundene våre forutsigbare bilavtaler, tydelig kommunikasjon og gode totalopplevelser.</p>\n\n<p>Gjennom Varebilleasing.no får du tilgang til et bredt utvalg biler, konkurransedyktige vilkår og løsninger som er tilpasset både hverdagsbruk og profesjonelle behov. Vi leverer biler over hele Norge og legger stor vekt på personlig oppfølging, transparens og trygghet i alle ledd.</p>'
      },
      'kontakt': {
        file: 'kontakt.md',
        title: 'Kontakt oss',
        meta: 'Kontakt Varebilleasing.no ved Automedia AS.',
        body: '<p>Ta kontakt med oss på <a href="mailto:post@automedia.as">post@automedia.as</a>.</p>'
      }
    };

    Object.entries(SIDE_DEFAULTS).forEach(([slug, def]) => {
      const sanityPage = sider.find(p => p.slug === slug);
      const intro = sanityPage?.heroText ? `<p>${sanityPage.heroText.replace(/\n/g, '<br>')}</p>\n\n` : '';
      const bodyHtml = intro + (sanityPage?.content?.length ? toHTML(sanityPage.content) : '');
      const finalBody = bodyHtml || def.body;
      fs.writeFileSync(path.join(omOssDir, def.file), `---
title: "${esc(sanityPage?.heroTitle || sanityPage?.title || def.title)}"
metadescription: "${esc(def.meta)}"
---
${finalBody}`);
    });
    console.log(`✅ Lagret om-oss og kontakt (${sider.length} fra Sanity, resten standardtekst).`);

    // /om-oss/ansatte/ (sweep kun denne mappen)
    const ansatteDir = path.join(__dirname, 'content', 'om-oss', 'ansatte');
    if (fs.existsSync(ansatteDir)) {
      console.log('Sweep: Rydder gamle ansatte...');
      fs.rmSync(ansatteDir, { recursive: true, force: true });
    }
    fs.mkdirSync(ansatteDir, { recursive: true });
    fs.writeFileSync(path.join(ansatteDir, '_index.md'), `---\ntitle: "Ansatte"\ntype: "ansatte"\nlayout: "list"\n---`);

    ansatte.forEach(person => {
      const slug = person.slug?.current || person.title.toLowerCase().replace(/\s+/g, '-');
      const content = `---
title: "${person.title}"
position: "${(person.campaignlink || 'Rådgiver').replace(/"/g, '\\"')}"
email: "${person.tagtwo || ''}"
phone: "${person.readtime || ''}"
image: "${person.bildeUrl || ''}"
type: "ansatte"
layout: "single"
---
${blocksToText(person.body)}`;
      fs.writeFileSync(path.join(ansatteDir, `${slug}.md`), content);
    });
    fs.writeFileSync(path.join(dataDir, 'employees.json'), JSON.stringify(ansatte, null, 2));

// --- 5. BILER ---
// ====================================================    
    console.log('Sweep: Bygger /biler/ mappen med korrekt menystruktur...');
    const bilerBaseDir = path.join(__dirname, 'content', 'biler');

    if (fs.existsSync(bilerBaseDir)) {
        fs.rmSync(bilerBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(bilerBaseDir, { recursive: true });

    fs.writeFileSync(path.join(bilerBaseDir, '_index.md'), `---
title: "Våre biler"
layout: "list"
url: "/biler/"
---`);

    data.biler.forEach(car => {
      if (!car.brand) return;

      const brandSlug = car.brand.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").replace(/\s+/g, '-');
      const brandDir = path.join(bilerBaseDir, brandSlug);

      if (!fs.existsSync(brandDir)) {
          fs.mkdirSync(brandDir, { recursive: true });
          
          const seoData = data.kategorier.find(kat => kat.slug === brandSlug);
          const finalTitle = seoData?.title || `Leasing av ${car.brand} privatbil`;
          const finalMeta = seoData?.description || `Finn gode tilbud på leasing av ${car.brand} privatbil hos Automedia.`;
          const finalBody = seoData?.body ? toHTML(seoData.body) : "";

          fs.writeFileSync(path.join(brandDir, '_index.md'), `---
title: "${finalTitle.replace(/"/g, '\\"')}"
metadescription: "${finalMeta.replace(/"/g, '\\"')}"
layout: "list"
url: "/biler/${brandSlug}/"
menu:
  main:
    name: "${car.brand}"
    parent: "Biler"
---
${finalBody}`);
      }

      const carSlug = car.slug?.current || `bil-${Math.random().toString(36).substr(2, 5)}`;
      const equipmentHtml = toHTML(car.equipment || []);
      const descriptionHtml = toHTML(car.description || []);

      const brandValue = car.brand?.title || car.brand?.name || car.brand || '';
      const cleanBrand = String(brandValue).replace(/"/g, '');
      const cleanSlug = String(carSlug).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

      const galleryYaml = car.galleryUrls && car.galleryUrls.length > 0 
        ? '\n' + car.galleryUrls.map(url => `  - "${url.replace(/\\/g, '')}?fm=webp&q=80"`).join('\n')
        : ' []';

      // Hjelpefunksjoner — skriver kun feltet hvis verdien ikke er tom
      const f = (key, val) => {
        const v = (val === null || val === undefined) ? '' : String(val).trim().replace(/\r?\n|\r/g, ' ');
        return v ? `${key}: "${v.replace(/"/g, "'")}"\n` : '';
      };
      const fNum = (key, val) => {
        const v = (val === null || val === undefined) ? '' : String(val).trim().replace(/\r?\n|\r/g, ' ');
        return (v && v !== '0') ? `${key}: "${v}"\n` : '';
      };
      const fBool = (key, val) => val ? `${key}: true\n` : '';

      const fields = [
        `title: "${(car.title || '').replace(/"/g, '')}"`,
        `brand: "${cleanBrand}"`,
        `slug: "${cleanSlug}"`,
        `layout: "single"`,
        car.mainImageUrl ? `mainimages: "${car.mainImageUrl.replace(/\\/g, '')}?fm=webp&q=80"` : '',
        car.shopimage    ? `shopimage: "${car.shopimage}"` : '',
        galleryYaml !== ' []' ? `gallery: ${galleryYaml}` : '',
        f('modeldescription', car.modeldescription),
        f('alttext', car.alttext),
        fNum('pricezero', car.pricezero),
        fNum('pricesixty', car.pricesixty),
        fNum('pricehundred', car.pricehundred),
        fNum('priceadszero', car.priceadszero),
        f('interest', car.interest),
        f('quote', car.quote),
        f('fuel', car.fuel),
        f('body', car.body),
        f('drive', car.drive),
        f('gear', car.gear),
        f('lversion', car.lversion),
        fNum('numberofgears', car.numberofgears),
        fNum('doors', car.doors),
        fNum('seats', car.seats),
        fNum('performancehk', car.performancehk),
        fNum('performancewatt', car.performancewatt),
        fNum('torque', car.torque),
        fNum('numberofengines', car.numberofengines),
        f('cotwoemission', car.cotwoemission),
        fNum('range', car.range),
        fNum('grossbattery', car.grossbattery),
        fNum('netbattery', car.netbattery),
        fNum('chargingdc', car.chargingdc),
        f('maxhomechargeac', car.maxhomechargeac),
        f('onephasehomechargeac', car.onephasehomechargeac),
        f('chargingspeed', car.chargingspeed),
        f('powerusage', car.powerusage),
        f('warranty', car.warranty),
        f('batterywarranty', car.batterywarranty),
        f('warrantypaint', car.warrantypaint),
        f('warrantyrust', car.warrantyrust),
        fNum('allowedtotalweight', car.allowedtotalweight),
        fNum('kerbweight', car.kerbweight),
        fNum('kerbweightexdriver', car.kerbweightexdriver),
        fNum('payloadincdriver', car.payloadincdriver),
        fNum('maxroofload', car.maxroofload),
        fNum('trailerwbreak', car.trailerwbreak),
        fNum('trailerwobreak', car.trailerwobreak),
        fNum('maxbootcapacity', car.maxbootcapacity),
        fNum('minbootcapacity', car.minbootcapacity),
        fNum('length', car.length),
        fNum('widthwomirrors', car.widthwomirrors),
        fNum('widthwmirrors', car.widthwmirrors),
        fNum('height', car.height),
        fNum('wheelbase', car.wheelbase),
        f('turningcircle', car.turningcircle),
        f('yearmodel', car.yearmodel),
        f('color', car.color),
        f('interior', car.interior),
        fBool('towbar', car.towbar),
        fBool('frontpage', car.frontpage),
        fBool('campaign', car.campaign),
        fBool('fastdelivery', car.fastdelivery),
        f('metatitle', car.metatitle),
        f('metadescription', car.metadescription),
        f('opengraphtitle', car.opengraphtitle),
        f('opengraphdescription', car.opengraphdescription),
        f('shortterm', car.shortterm),
        f('pricecomment', car.pricecomment),
        f('salesman', car.salesman),
        f('availability', car.availability),
        f('consultant', car.consultant),
        f('sourceslug', car.sourceslug),
        f('sourceslugad', car.sourceslugad),
        f('chosepage', car.chosepage),
        f('shop', car.shop),
        descriptionHtml ? `descriptionHtml: ${JSON.stringify(descriptionHtml)}` : '',
        equipmentHtml   ? `equipmentHtml: ${JSON.stringify(equipmentHtml)}` : '',
      ].filter(Boolean).join('\n');

      const content = `---\n${fields}\n---`;


      fs.writeFileSync(path.join(brandDir, `${carSlug}.md`), content);
    });

    console.log(`✅ Lagret ${data.biler.length} biler i /biler/[merke]/.`);


// --- 6. KATEGORISIDER ---
// ====================================================
    console.log('Bygger kategorisider under /biler/...');

    const CATEGORY_PAGES = [
        // Drivstoff
        { slug: 'leasing-privatbil-bensin',    field: 'fuel',  value: 'Bensin',       defaultTitle: 'bensin' },
        { slug: 'leasing-privatbil-diesel',    field: 'fuel',  value: 'Diesel',       defaultTitle: 'diesel' },
        { slug: 'leasing-privatbil-elektrisk', field: 'fuel',  value: 'Elektrisitet', defaultTitle: 'elektrisk' },
        { slug: 'leasing-privatbil-cng',       field: 'fuel',  value: 'CNG',          defaultTitle: 'CNG' },
        // Dører
        { slug: 'leasing-privatbil-2-dorer',   field: 'doors', value: '2',            defaultTitle: '2 dører' },
        { slug: 'leasing-privatbil-4-dorer',   field: 'doors', value: '4',            defaultTitle: '4 dører' },
        { slug: 'leasing-privatbil-5-dorer',   field: 'doors', value: '5',            defaultTitle: '5 dører' },
        // Seter
        { slug: 'leasing-privatbil-3-seter',   field: 'seats', value: '3',            defaultTitle: '3 seter' },
        { slug: 'leasing-privatbil-5-seter',   field: 'seats', value: '5',            defaultTitle: '5 seter' },
        { slug: 'leasing-privatbil-6-seter',   field: 'seats', value: '6',            defaultTitle: '6 seter' },
        { slug: 'leasing-privatbil-7-seter',   field: 'seats', value: '7',            defaultTitle: '7 seter' },
        // Hjuldrift
        { slug: 'leasing-privatbil-awd',       field: 'drive', value: 'AWD',          defaultTitle: 'AWD' },
        { slug: 'leasing-privatbil-rwd',       field: 'drive', value: 'Bak',          defaultTitle: 'bakhjulstrekk' },
        { slug: 'leasing-privatbil-fwd',       field: 'drive', value: 'Foran',        defaultTitle: 'forhjulstrekk' },
    ];

    CATEGORY_PAGES.forEach(cat => {
        const catDir = path.join(bilerBaseDir, cat.slug);
        if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });

        const seoData = data.kategorier.find(k => k.slug === cat.slug);
        const finalTitle = seoData?.title || cat.defaultTitle;
        const finalMeta = seoData?.description || `Finn gode tilbud på ${cat.defaultTitle.toLowerCase()} hos Automedia.`;
        const finalBody = seoData?.body ? toHTML(seoData.body) : '';

        fs.writeFileSync(path.join(catDir, '_index.md'), `---
title: "${finalTitle.replace(/"/g, '\\"')}"
metadescription: "${finalMeta.replace(/"/g, '\\"')}"
layout: "list"
url: "/biler/${cat.slug}/"
---
${finalBody}`);
    });

    const ALL_BRANDS = [
      'Audi', 'BMW', 'BYD', 'Citroën', 'Fiat', 'Ford', 'Honda', 'Hyundai',
      'Isuzu', 'Kia', 'Maxus', 'Mazda', 'Mercedes', 'MG', 'MINI', 'Mitsubishi',
      'Nissan', 'Opel', 'Peugeot', 'Polestar', 'Renault', 'Skoda', 'Smart',
      'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo', 'Xpeng'
    ];

    ALL_BRANDS.forEach(brandName => {
      const brandSlug = brandName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").replace(/\s+/g, '-');
      const brandDir = path.join(bilerBaseDir, brandSlug);
      if (!fs.existsSync(brandDir)) {
        fs.mkdirSync(brandDir, { recursive: true });
        const seoData = data.kategorier.find(kat => kat.slug === brandSlug);
        const finalTitle = seoData?.title || `Leasing av ${brandName} privatbil`;
        const finalMeta = seoData?.description || `Finn gode tilbud på leasing av ${brandName} privatbil hos Automedia.`;
        const finalBody = seoData?.body ? toHTML(seoData.body) : "";
        fs.writeFileSync(path.join(brandDir, '_index.md'), `---
title: "${finalTitle.replace(/"/g, '\\"')}"
metadescription: "${finalMeta.replace(/"/g, '\\"')}"
layout: "list"
url: "/biler/${brandSlug}/"
---
${finalBody}`);
      }
    });

    console.log(`✅ Opprettet ${CATEGORY_PAGES.length} kategorisider.`);


// --- 7. TJENESTER ---
// ====================================================
    const servicesDir = path.join(__dirname, 'content', 'tjenester');
    if (fs.existsSync(servicesDir)) {
        console.log('Sweep: Rydder gamle tjenester...');
        fs.rmSync(servicesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(servicesDir, { recursive: true });
    fs.writeFileSync(path.join(servicesDir, '_index.md'), `---\ntitle: "Våre Tjenester"\nlayout: "list"\n---`);

    const tjenester = await client.fetch(`*[_type == "service"] {
      ...,
      "image": image.asset->url,
      "salesmanName": salesman->title,
      "salesmanImage": salesman->mainImage.asset->url,
      "salesmanEmail": salesman->tagtwo,
      "salesmanPhone": salesman->readtime,
      "salesmanLinkedin": salesman->tagone,
      "salesmanCampaign": salesman->campaignlink,
      "salesmanExcerpt": salesman->metadescription
    }`);

    tjenester.forEach(service => {
      const slug = service.slug?.current || service.title.toLowerCase().replace(/\s+/g, '-');
      const bodyHtml = toHTML(service.body || []);
      const leadHtml = (service.lead || '').replace(/\n/g, '<br>');
      const finalHtml = bodyHtml || leadHtml;

      // Hent ansatt-data fra GROQ-resolvert referanse
      const salesmanName = service.salesmanName || '';
      const salesmanImage = service.salesmanImage || '';
      const salesmanEmail = service.salesmanEmail || service.email || '';
      const salesmanPhone = service.salesmanPhone || '';
      const salesmanLinkedin = service.salesmanLinkedin || '';
      const salesmanCampaign = service.salesmanCampaign || '';
      const salesmanExcerpt = service.salesmanExcerpt || '';

      const content = `---
title: "${(service.title || '').replace(/"/g, '\\"')}"
image: "${service.image || ''}"
alt: "${(service.alt || '').replace(/"/g, '\\"')}"
email: "${salesmanEmail}"
salesman: "${salesmanName}"
salesmanimage: "${salesmanImage}"
salesmanphone: "${salesmanPhone}"
salesmanlinkedin: "${salesmanLinkedin}"
salesmancampaign: "${salesmanCampaign}"
salesmanexcerpt: "${salesmanExcerpt}"
metatitle: "${(service.metatitle || '').replace(/"/g, '\\"')}"
metadescription: "${(service.metadescription || '').replace(/"/g, '\\"')}"
bodyHtml: "${finalHtml.replace(/"/g, '\\"').replace(/\r?\n|\r/g, '')}"
---`;

      fs.writeFileSync(path.join(servicesDir, `${slug}.md`), content);
    });

    console.log(`✅ Lagret ${tjenester.length} tjenester.`);

  } catch (error) {
    console.error('❌ Feil under kjøring:', error);
  }
}

run();