import unittest

from build import parse_entry, normalize_term, compact_meanings, prefer_entry


class DictionaryBuildTests(unittest.TestCase):
    def test_extracts_definitions_not_example_translations_or_other_entries(self):
        result = parse_entry('''<div class="entry-body__el">
          <div class="pos-header"><span class="pos">noun</span>
            <span class="uk"><span class="ipa">bæŋk</span></span>
            <span class="us"><span class="ipa">bæŋk</span></span></div>
          <div class="ddef_d">definition <span class="trans" lang="zh">银行</span></div>
          <div class="examp"><span class="trans">我去了银行。</span></div>
          <div class="ddef_d"><span class="trans">河岸</span></div>
          <div class="phrase-block"><div class="ddef_d"><span class="trans">依靠某人</span></div></div>
        </div><div class="entry-body__el"><div class="pos-header"><span class="pos">verb</span></div>
          <div class="ddef_d"><span class="trans">存钱</span></div></div>''')
        self.assertEqual(result['partOfSpeech'], 'n. / v.')
        self.assertEqual(result['meaningZh'], 'n. 银行；河岸\nv. 存钱')
        self.assertEqual(result['phoneticUk'], '/bæŋk/')
        self.assertNotIn('我去了', result['meaningZh'])
        self.assertNotIn('依靠', result['meaningZh'])

    def test_link_and_form_entry(self):
        self.assertEqual(parse_entry('@@@LINK=Apple\r\n\x00'), 'apple')
        result = parse_entry('''<div class="entry-body__el"><div class="pos-header"><span class="pos">verb</span></div>
        <div class="ddef_d"><span class="trans">（go的过去式）</span></div></div>''')
        self.assertEqual(result['baseTerm'], 'go')

    def test_english_only_and_script_text_are_not_definitions(self):
        self.assertIsNone(parse_entry('<script>银行</script><div class="ddef_d">A bank.</div>'))

    def test_compaction_keeps_whole_senses_and_marks_omissions(self):
        meaning = compact_meanings(['短释义', '长' * 198, '另一项'])
        self.assertLessEqual(len(meaning), 200)
        self.assertEqual(meaning, '短释义；…')
        self.assertLessEqual(len(compact_meanings(['长' * 250])), 200)

    def test_normalization(self):
        self.assertEqual(normalize_term('  Mother‑in‑law’s  '), "mother-in-law's")

    def test_duplicate_alias_prefers_matching_stem_and_never_overwrites_definition(self):
        self.assertEqual(prefer_entry('restores', 'store', 'restore'), 'restore')
        self.assertEqual(prefer_entry('restores', 'restore', 'store'), 'restore')
        definition = {'meaningZh': '恢复'}
        self.assertEqual(prefer_entry('restore', definition, 'store'), definition)


if __name__ == '__main__':
    unittest.main()
