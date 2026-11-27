// Step 3 Reader: Word and PowerPoint XML → neutral blocks/slides. Synthetic XML (no real course files).

import { imageMime, parseDocx, parsePptx, resolvePath } from '../../src/client/reader/ooxml.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const enc = (s: string) => new TextEncoder().encode(s);
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

export function register(test: TestFn, assert: Assert): void {
  test('ooxml: relationship targets resolve relative to the referring part', () => {
    assert.equal(resolvePath('ppt/slides/slide1.xml', '../media/image1.png'), 'ppt/media/image1.png');
    assert.equal(resolvePath('word/document.xml', 'media/image2.jpeg'), 'word/media/image2.jpeg');
    assert.equal(resolvePath('ppt/presentation.xml', '/ppt/slides/slide3.xml'), 'ppt/slides/slide3.xml');
    assert.equal(imageMime('word/media/a.JPG'), 'image/jpeg');
    assert.equal(imageMime('ppt/media/a.emf'), null);
    assert.equal(imageMime('ppt/media/a.svg'), null, 'SVG is never shown');
  });

  test('docx: headings, formatting, numbered vs bulleted lists, tables, images and equations', () => {
    const doc = `<w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heat transfer</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Step one</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr></w:pPr><w:r><w:t>A bullet</w:t></w:r></w:p>
      <w:p><w:hyperlink r:id="rLink"><w:r><w:t>linked text</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:r><w:drawing><a:blip r:embed="rImg"/></w:drawing></w:r></w:p>
      <w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>k</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>0.6</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p></w:p>
    </w:body></w:document>`;
    const numbering = `<w:numbering ${W}>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
      <w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="8"><w:abstractNumId w:val="2"/></w:num>
    </w:numbering>`;
    const rels = `<Relationships ${RELS}><Relationship Id="rImg" Type="…/image" Target="media/image1.png"/><Relationship Id="rLink" Type="…/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`;
    const blocks = parseDocx({ 'word/document.xml': enc(doc), 'word/numbering.xml': enc(numbering), 'word/_rels/document.xml.rels': enc(rels) });
    assert.deepEqual(blocks[0], { type: 'heading', level: 1, runs: [{ text: 'Heat transfer', bold: undefined, italic: undefined, underline: undefined, sup: undefined, sub: undefined }] });
    const p = blocks[1];
    assert.ok(p?.type === 'para' && p.runs[0]?.bold === true && p.runs[1]?.text === ' and ' && p.runs[2]?.sup === true);
    assert.ok(blocks[2]?.type === 'item' && blocks[2].ordered === true && blocks[2].level === 1);
    assert.ok(blocks[3]?.type === 'item' && blocks[3].ordered === false);
    assert.ok(blocks[4]?.type === 'para' && blocks[4].runs[0]?.text === 'linked text', 'hyperlink runs are kept as text');
    assert.deepEqual(blocks[5], { type: 'image', path: 'word/media/image1.png' });
    assert.ok(blocks[6]?.type === 'para' && blocks[6].runs[0]?.text === '⟨equation⟩');
    assert.ok(blocks[7]?.type === 'table' && blocks[7].rows[0]?.[1]?.[0]?.text === '0.6');
    assert.equal(blocks.length, 8, 'empty paragraphs are dropped');
  });

  test('pptx: slides in presentation order, titles, bullet levels, images and speaker notes', () => {
    const pres = `<p:presentation ${P}><p:sldIdLst><p:sldId id="257" r:id="rS2"/><p:sldId id="256" r:id="rS1"/></p:sldIdLst></p:presentation>`;
    const presRels = `<Relationships ${RELS}><Relationship Id="rS1" Type="…/slide" Target="slides/slide1.xml"/><Relationship Id="rS2" Type="…/slide" Target="slides/slide2.xml"/></Relationships>`;
    const sp = (ph: string | null, paras: Array<[string, number]>) => `<p:sp><p:nvSpPr><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.map(([t, l]) => `<a:p><a:pPr lvl="${l}"/><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
    const slide1 = `<p:sld ${P}><p:cSld><p:spTree>${sp('title', [['Fourier’s law', 0]])}${sp(null, [['q = −k∇T', 0], ['k is conductivity', 1]])}<p:pic><p:blipFill><a:blip r:embed="rI"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`;
    const slide1Rels = `<Relationships ${RELS}><Relationship Id="rI" Type="…/image" Target="../media/image1.png"/><Relationship Id="rN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`;
    const notes = `<p:notes ${P}><p:cSld><p:spTree>${sp('sldImg', [])}${sp('body', [['Mention the minus sign', 0]])}</p:spTree></p:cSld></p:notes>`;
    const slide2 = `<p:sld ${P}><p:cSld><p:spTree>${sp('ctrTitle', [['Course intro', 0]])}</p:spTree></p:cSld></p:sld>`;
    const slides = parsePptx({
      'ppt/presentation.xml': enc(pres), 'ppt/_rels/presentation.xml.rels': enc(presRels),
      'ppt/slides/slide1.xml': enc(slide1), 'ppt/slides/_rels/slide1.xml.rels': enc(slide1Rels),
      'ppt/notesSlides/notesSlide1.xml': enc(notes), 'ppt/slides/slide2.xml': enc(slide2),
    });
    assert.equal(slides.length, 2);
    assert.equal(slides[0]?.title, 'Course intro', 'order follows sldIdLst, not file names');
    assert.equal(slides[1]?.number, 2);
    assert.equal(slides[1]?.title, 'Fourier’s law');
    assert.deepEqual(slides[1]?.lines, [{ text: 'q = −k∇T', level: 0 }, { text: 'k is conductivity', level: 1 }]);
    assert.deepEqual(slides[1]?.images, ['ppt/media/image1.png']);
    assert.deepEqual(slides[1]?.notes, ['Mention the minus sign']);
  });
}
