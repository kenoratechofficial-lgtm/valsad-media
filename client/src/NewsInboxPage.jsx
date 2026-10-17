import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Clock3, Download, LoaderCircle, Newspaper, Search } from 'lucide-react';
import { api } from './api.js';
import './NewsInboxPage.css';

const formatDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

function NewsStoryImage({ src }) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return <div className="news-story-placeholder"><Newspaper size={27}/><span>IMAGE UNAVAILABLE</span></div>;
  }
  return <img className="news-story-image" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}

export default function NewsInboxPage() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('Valsad OR Vapi OR Gujarat');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([api.get('/admin/imported-news'), api.get('/admin/categories')])
      .then(([news, cats]) => {
        setItems(news.data.items || []);
        setCategories(cats.data || []);
      })
      .catch(() => setError('Could not load the news inbox. Please refresh and try again.'))
      .finally(() => setLoading(false));
  }, []);

  const selectedCategory = categories.find(category => category._id === categoryId);
  const selectedSlug = selectedCategory?.slug?.en || selectedCategory?.slug?.gu || '';
  const visibleItems = useMemo(
    () => categoryId ? items.filter(item => item.category === selectedSlug) : items,
    [items, categoryId, selectedSlug],
  );

  const fetchNews = async event => {
    event.preventDefault();
    if (!categoryId) {
      setError('Choose a category before fetching stories.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/admin/imported-news/fetch-bilingual', { q: query, categoryId });
      setItems(previous => [...data.items, ...previous.filter(item => !data.items.some(next => next._id === item._id))]);
      setNotice('Fetched ' + data.fetched + ' stories: ' + data.byLanguage.en + ' English and ' + data.byLanguage.gu + ' Gujarati. Choose a story below to import it as a draft.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'News fetch failed. Check the provider settings and API key.');
    } finally {
      setBusy(false);
    }
  };

  const importStory = async id => {
    setActive(id);
    setError('');
    setNotice('');
    try {
      await api.post('/admin/imported-news/' + id + '/import');
      setItems(current => current.filter(item => item._id !== id));
      setNotice('Imported as a draft. Add its translation in Articles if you want to publish the same story in both languages.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not import this story. Please try again.');
    } finally {
      setActive('');
    }
  };

  return (
    <div className="news-inbox-page">
      <form className="admin-panel fetch-form" onSubmit={fetchNews}>
        <div>
          <h2>Fetch stories in both languages</h2>
          <p>Choose a newsroom category. One search fetches both English and Gujarati results from GNews.</p>
        </div>
        <label>Category
          <select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
            <option value="">Choose a category</option>
            {categories.map(category => <option key={category._id} value={category._id}>{category.name?.en || category.name?.gu}</option>)}
          </select>
        </label>
        <label>Search terms
          <input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="e.g. Valsad OR Vapi"/>
        </label>
        <button className="primary" disabled={busy || !categoryId}>
          {busy ? <><LoaderCircle className="news-spinner" size={16}/> Fetching both</> : <><Search size={16}/> Fetch English + Gujarati</>}
        </button>
        <div className="news-language-note">GNews returns separate stories for each language. It does not translate a story; add the other language in Articles before publishing a bilingual version.</div>
      </form>

      {error && <div className="admin-notice" role="alert">{error}</div>}
      {notice && <div className="admin-success" role="status">{notice}</div>}

      <section className="news-review-section">
        <div className="news-review-heading">
          <div><span className="news-section-kicker">EDITORIAL WORKSPACE</span><h2>Review queue <span>{visibleItems.length}</span></h2></div>
          <div className="news-queue-summary"><Newspaper size={16}/>{categoryId ? selectedCategory?.name?.en || selectedCategory?.name?.gu : 'All categories'}<i/>{items.length} pending</div>
        </div>

        {loading ? (
          <div className="news-queue-state"><LoaderCircle className="news-spinner" size={22}/><span>Loading stories…</span></div>
        ) : visibleItems.length ? (
          <div className="news-story-grid">
            {visibleItems.map(item => {
              const categoryName = categories.find(category => (category.slug?.en || category.slug?.gu) === item.category)?.name?.en || item.category || 'Uncategorized';
              const languageName = item.language === 'gu' ? 'ગુજરાતી' : 'English';
              return (
                <article className="news-story-card" key={item._id}>
                  <NewsStoryImage src={item.imageUrl}/>
                  <div className="news-story-content">
                    <div className="news-story-meta"><span className="news-category-tag">{categoryName}</span><span className="news-language-chip">{languageName}</span><span>{item.sourceName || 'News source'}</span></div>
                    <h3>{item.title}</h3>
                    {item.description && <p>{item.description}</p>}
                    <div className="news-story-date"><Clock3 size={13}/>{formatDate(item.publishedAt) || 'Recently fetched'}</div>
                    <div className="news-story-actions">
                      {item.originalUrl && <a href={item.originalUrl} target="_blank" rel="noreferrer">Read original <ArrowUpRight size={15}/></a>}
                      <button type="button" className="news-import-button" disabled={active === item._id} onClick={() => importStory(item._id)}>
                        {active === item._id ? <><LoaderCircle className="news-spinner" size={15}/> Importing</> : <><Download size={15}/> Import draft</>}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="news-empty-state"><span className="news-empty-icon"><Newspaper size={23}/></span><h3>{categoryId ? 'No stories in this category' : 'Your review queue is clear'}</h3><p>{categoryId ? 'Fetch category news above to find stories for your newsroom.' : 'Choose a category above and fetch stories to start your review.'}</p></div>
        )}
      </section>
    </div>
  );
}
