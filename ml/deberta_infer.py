import argparse
import json
import sys
import os


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--texts', required=True, help='JSON array of text strings')
    parser.add_argument('--labels', required=True, help='Comma-separated candidate labels')
    args = parser.parse_args()

    try:
        texts  = json.loads(args.texts)
        labels = [l.strip() for l in args.labels.split(',')]
    except Exception:
        print(json.dumps([]), flush=True)
        sys.exit(0)

    if not texts:
        print(json.dumps([]), flush=True)
        sys.exit(0)

    try:
        os.environ['TRANSFORMERS_NO_ADVISORY_WARNINGS'] = '1'
        os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'

        import warnings
        warnings.filterwarnings('ignore')

        from transformers import pipeline

        cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'model_cache')
        os.makedirs(cache_dir, exist_ok=True)

        print('[DeBERTa] Loading model (may download ~500 MB on first run)…', file=sys.stderr, flush=True)

        classifier = pipeline(
            'zero-shot-classification',
            model='cross-encoder/nli-deberta-v3-small',
            cache_dir=cache_dir,
            device=-1,  # CPU
        )

        print(f'[DeBERTa] Classifying {len(texts)} texts…', file=sys.stderr, flush=True)

        results = []
        for text in texts:
            out  = classifier(text[:512], candidate_labels=labels, multi_label=False)
            # Pair each label with its score, pick the highest
            scored = list(zip(out['labels'], out['scores']))
            best   = max(scored, key=lambda x: x[1])
            results.append({
                'label': best[0],
                'score': round(best[1], 3),
            })

        # Print ONLY the JSON array to stdout — nothing else
        print(json.dumps(results), flush=True)

    except Exception as e:
        print(f'[DeBERTa] Error: {e}', file=sys.stderr, flush=True)
        print(json.dumps([]), flush=True)
        sys.exit(0)


if __name__ == '__main__':
    main()
